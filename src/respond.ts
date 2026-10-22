import { createHash } from 'node:crypto';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { lineageIssues } from './lineage-state.ts';
import type { LineageIssue } from './lineage.ts';
import { isReviewNotice } from './findings.ts';
import { botComments, evaluateRound } from './round.ts';
import { reviewItems } from './tracker.ts';
import { VERDICTS } from './types.ts';
import type { GitHubTransport, PullRequest, ReviewThread } from './types.ts';

/** Review services eligible for automatic votes; other bots require explicit configuration. */
const DEFAULT_BOTS = 'coderabbitai,greptile-apps,gemini-code-assist,sourcery-ai,copilot-pull-request-reviewer,codex,cubic,qodo-code-review';
/** Shared command policy; comma-separated logins replace defaults, a pattern extends notice detection. */
export interface ResponseOptions { bots?: string | undefined; noticePattern?: string | undefined; apply?: boolean | undefined; resolve?: boolean | undefined }
/** A fully planned action, retained individually in dry-run and application receipts. */
export type ResponseAction = { kind: 'reply'; finding: string; thread: string; body: string } | { kind: 'vote'; node: string; content: 'THUMBS_UP' | 'THUMBS_DOWN' } | { kind: 'resolve'; thread: string };

/** Compare service logins independently of GitHub's optional bot suffix. */
function login(value: string): string { return value.toLowerCase().replace(/\[bot\]$/, ''); }

/** Bind a finding to its recorded decision without publishing the fingerprint inputs. */
export function responseMarker(item: ItemMetadata): string {
  const fingerprint = createHash('sha256').update(JSON.stringify([item.review_verdict, item.review_reason, item.review_verdict === 'fix' ? item.review_commit : ''])).digest('hex').slice(0, 16);
  return `<!-- pm-review:finding:${encodeURIComponent(item.id)} decision:${fingerprint} -->`;
}

/** Require a marker from the applying account, so bot quotations cannot suppress a reply. */
function hasReply(thread: ReviewThread, marker: string, viewer: string): boolean {
  return thread.comments.some(comment => comment.bot.toLowerCase() === viewer.toLowerCase() && comment.body.includes(marker));
}

/** Final decisions require durable reasoning and fix decisions additionally require commit evidence. */
function decided(item: ItemMetadata): boolean {
  return VERDICTS.some(verdict => verdict !== 'pending' && verdict === item.review_verdict) && typeof item.review_reason === 'string' && item.review_reason.trim().length > 0 && (item.review_verdict !== 'fix' || /^[a-f0-9]{7,40}$/i.test(String(item.review_commit)));
}

/** Refuse unsafe publication instead of silently changing the recorded decision. */
function replyBody(item: ItemMetadata, supersedes: boolean): string {
  const reason = String(item.review_reason).trim();
  if (/@|\b(?:Bearer\s|gh[pousr]_|github_pat_|sk-[A-Za-z0-9]|[A-Za-z]:\\)|(?:^|[\s"'`(])\/(?:[\w.-]+\/|tmp\b)|<!--/i.test(reason)) throw new Error('Unsafe verdict reason: remove mentions, credentials, private paths and hidden markup before responding');
  return `pm-review: ${String(item.review_verdict)}\n\n${reason}${item.review_verdict === 'fix' ? `\n\nCommit: ${String(item.review_commit)}` : ''}${supersedes ? '\n\nThis reply supersedes the earlier reply for this finding.' : ''}\n\n${responseMarker(item)}`;
}

/** Plan votes and replies only after complete remote and tracker reads; no mutations occur here. */
export function responsePlan(pr: PullRequest, items: ItemMetadata[], viewer: string, options: ResponseOptions): { actions: ResponseAction[]; missingVerdicts: string[]; missingReplies: string[]; staleReplies: string[]; issues?: LineageIssue[] } {
  const bots = new Set((options.bots ?? DEFAULT_BOTS).split(',').map(value => login(value.trim())));
  const notice = options.noticePattern === undefined ? null : new RegExp(options.noticePattern, 'i');
  const actions: ResponseAction[] = [];
  const scoped = items.filter(item => item.review_repo === pr.repo && item.review_pr === pr.number);
  const missingVerdicts = scoped.filter(item => !decided(item) && item.review_verdict !== 'informational').map(item => item.id);
  const missingReplies: string[] = [];
  const staleReplies: string[] = [];
  for (const item of scoped.filter(candidate => candidate.review_kind === 'thread' && decided(candidate))) {
    const thread = pr.threads.find(candidate => candidate.id === item.review_thread_id);
    if (!thread) throw new Error('Recorded verdict thread is missing from the complete PR snapshot');
    if (!hasReply(thread, responseMarker(item), viewer)) {
      const stale = hasReply(thread, `<!-- pm-review:finding:${encodeURIComponent(item.id)} `, viewer);
      (stale ? staleReplies : missingReplies).push(item.id);
      actions.push({ kind: 'reply', finding: item.id, thread: thread.id, body: replyBody(item, stale) });
    }
    if (options.resolve && !thread.resolved) actions.push({ kind: 'resolve', thread: thread.id });
  }
  for (const source of botComments(pr).filter(comment => bots.has(login(comment.bot)))) {
    if (source.reactions.some(reaction => reaction.user.toLowerCase() === viewer.toLowerCase() && ['THUMBS_UP', 'THUMBS_DOWN'].includes(reaction.content))) continue;
    actions.push({ kind: 'vote', node: source.id, content: isReviewNotice(source.body) || notice?.test(source.body) ? 'THUMBS_DOWN' : 'THUMBS_UP' });
  }
  const issues = lineageIssues(items);
  return { actions, missingVerdicts, missingReplies, staleReplies, ...(issues.length ? { issues } : {}) };
}

/** Batch recorded replies and all missing service votes; GitHub writes require explicit apply. */
export async function respond(client: PmClient, transport: GitHubTransport, repo: string, pr: number, options: ResponseOptions = {}): Promise<{ repo: string; pr: number; dry_run: boolean; actions: ResponseAction[]; issues?: LineageIssue[] }> {
  const snapshot = await transport.snapshot(repo, pr);
  const plan = responsePlan(snapshot, await reviewItems(client), await transport.viewer(), options);
  if (options.apply) {
    for (const action of plan.actions) {
      if (action.kind === 'reply') await transport.reply(action.thread, action.body);
      else if (action.kind === 'vote') await transport.react(action.node, action.content);
      else await transport.resolve(action.thread);
    }
  }
  return { repo, pr, dry_run: !options.apply, actions: plan.actions, ...(plan.issues ? { issues: plan.issues } : {}) };
}

/** Audit imported decisions and live threads/votes, reusing round's exact-head completion evidence. */
export async function reviewStatus(client: PmClient, transport: GitHubTransport, repo: string, pr: number, options: ResponseOptions = {}) {
  const snapshot = await transport.snapshot(repo, pr);
  const items = await reviewItems(client);
  const plan = responsePlan(snapshot, items, await transport.viewer(), options);
  const round = evaluateRound(snapshot, items);
  const unvoted_bot_items = plan.actions.filter(action => action.kind === 'vote');
  const complete = unvoted_bot_items.length === 0 && plan.missingVerdicts.length === 0 && plan.missingReplies.length === 0 && plan.staleReplies.length === 0 && round.unresolved_threads.length === 0 && round.coderabbit_finished;
  return { ...(plan.issues ? { issues: plan.issues } : {}), repo, pr, head: snapshot.head, complete, unvoted_bot_items, findings_without_verdict: plan.missingVerdicts, verdicts_without_reply: plan.missingReplies, stale_replies: plan.staleReplies, unresolved_threads: round.unresolved_threads, current_head_review_completed: round.coderabbit_finished, ...complete ? {} : { exit_code: 1 } };
}
