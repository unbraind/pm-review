import { createHash } from 'node:crypto';
import { createPmCliExpectedError, PmClient } from '@unbrained/pm-cli/sdk';
import { closeFinding, fieldOptions, recordVerdict, reviewItems } from './tracker.ts';
import { isReviewNotice } from './findings.ts';
import { VERDICTS } from './types.ts';
import type { Contribution, GitHubTransport, Verdict } from './types.ts';

/** Validate vocabulary before the SDK or GitHub receives any mutation. */
export function parseVerdict(value: string): Verdict {
  value = value === 'fixed' ? 'fix' : value === 'refused' ? 'refuse' : value;
  const verdict = VERDICTS.find(/** Runtime input must exactly match a registered decision. */ candidate => candidate === value);
  if (!verdict) throw new Error(`Invalid verdict: choose ${VERDICTS.join('|')}`);
  return verdict;
}

/** Decision input separates durable tracker writes from explicit remote application. */
export interface VerdictInput { id: string; verdict: Verdict; reason: string; commit: string; repo: string; pr: number; apply: boolean }
/** Application receipt reports only mutations actually performed by this invocation. */
export interface VerdictReceipt { item: string; verdict: Verdict; applied: boolean; replied: boolean; reacted: boolean; resolved: boolean }

/** Add only a missing vote from the applying account through the existing API boundary. */
async function voteSource(transport: GitHubTransport, source: Contribution, viewer: string, reaction: 'THUMBS_UP' | 'THUMBS_DOWN'): Promise<boolean> {
  if (source.reactions.some(/** Another account's reaction cannot deduplicate this actor's vote. */ existing => existing.user.toLowerCase() === viewer.toLowerCase() && existing.content === reaction)) return false;
  await transport.react(source.id, reaction);
  return true;
}

/** Record a decision and optionally replay-safe thread reply, vote and resolution. */
export async function decide(client: PmClient, transport: GitHubTransport | undefined, input: VerdictInput): Promise<VerdictReceipt> {
  if (!input.reason.trim()) throw new Error('A nonempty --reason is required');
  if (input.commit && !/^[a-f0-9]{7,40}$/i.test(input.commit)) throw new Error('--commit must be a Git commit SHA');
  const item = (await reviewItems(client)).find(/** Only imported typed findings accept review decisions. */ candidate => candidate.id === input.id);
  if (!item) throw createPmCliExpectedError('Review item not found; import this PR first', { context: { code: 'finding_missing', nextSteps: ['Import the ReviewFinding before recording a verdict.'] } });
  if (item.review_repo !== input.repo || item.review_pr !== input.pr) throw new Error('The item belongs to a different repository or PR');
  const receipt: VerdictReceipt = { item: item.id, verdict: input.verdict, applied: false, replied: false, reacted: false, resolved: false };
  if (!input.apply) {
    await recordVerdict(client, item, input.verdict, input.reason, input.commit);
    return receipt;
  }
  if (input.verdict === 'pending') throw new Error('--apply requires a final verdict; pending decisions stay local');
  if (input.verdict === 'fix' && !input.commit) throw new Error('--apply fix requires --commit evidence');
  if (!transport) throw new Error('GitHub transport is required for --apply');
  const evidence = `${input.verdict}: ${input.reason}${input.commit ? `; commit ${input.commit}` : ''}`;
  const snapshot = await transport.snapshot(input.repo, input.pr);
  if (item.review_kind !== 'thread') {
    const sources = item.review_kind === 'review' ? snapshot.reviews : snapshot.comments;
    const source = sources.find(/** Validate source provenance against the current PR before voting. */ candidate => candidate.id === item.review_node_id && candidate.isBot);
    if (!source) throw new Error('Bot review content no longer exists on this PR');
    const viewer = await transport.viewer();
    const reaction = isReviewNotice(source.body) ? 'THUMBS_DOWN' : 'THUMBS_UP';
    await recordVerdict(client, item, input.verdict, input.reason, input.commit);
    receipt.reacted = await voteSource(transport, source, viewer, reaction);
    await closeFinding(client, item, evidence);
    receipt.applied = true;
    return receipt;
  }
  const thread = snapshot.threads.find(/** Source identity must still exist in the requested PR before remote writes. */ candidate => candidate.id === item.review_thread_id);
  if (!thread) throw new Error('Review thread no longer exists on this PR');
  const source = thread.comments.find(/** The first bot contribution is the thread finding imported by this package. */ comment => comment.isBot);
  if (!source) throw new Error('Review thread has no bot contribution');
  const viewer = await transport.viewer();
  const marker = createHash('sha256').update(JSON.stringify([thread.id, input.verdict, input.reason, input.commit])).digest('hex');
  const reply = `pm-review: ${input.verdict}\n\n${input.reason}${input.commit ? `\n\nCommit: ${input.commit}` : ''}\n\n<!-- pm-review:${marker} -->`;
  // Save the durable decision before remote writes, so a failed action can be retried with its reasoning intact.
  await recordVerdict(client, item, input.verdict, input.reason, input.commit);
  if (!thread.comments.some(/** A stable decision marker plus actor identity deduplicates retries across trackers. */ comment => comment.bot.toLowerCase() === viewer.toLowerCase() && comment.body === reply)) {
    await transport.reply(thread.id, reply);
    receipt.replied = true;
  }
  const reaction = input.verdict === 'refuse' ? 'THUMBS_DOWN' : 'THUMBS_UP';
  receipt.reacted = await voteSource(transport, source, viewer, reaction);
  if (!thread.resolved) {
    await transport.resolve(thread.id);
    receipt.resolved = true;
  }
  await client.update(item.id, fieldOptions({ review_resolved: true }));
  await closeFinding(client, item, evidence);
  receipt.applied = true;
  return receipt;
}
