import { createHash } from 'node:crypto';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { fieldOptions, recordVerdict, reviewItems } from './tracker.ts';
import { VERDICTS } from './types.ts';
import type { GitHubTransport, Verdict } from './types.ts';

/** Validate vocabulary before the SDK or GitHub receives any mutation. */
export function parseVerdict(value: string): Verdict {
  const verdict = VERDICTS.find(/** Runtime input must exactly match a registered decision. */ candidate => candidate === value);
  if (!verdict) throw new Error(`Invalid verdict: choose ${VERDICTS.join('|')}`);
  return verdict;
}

/** Decision input separates durable tracker writes from explicit remote application. */
export interface VerdictInput { id: string; verdict: Verdict; reason: string; commit: string; repo: string; pr: number; apply: boolean }
/** Application receipt reports only mutations actually performed by this invocation. */
export interface VerdictReceipt { item: string; verdict: Verdict; applied: boolean; replied: boolean; reacted: boolean; resolved: boolean }

/** Record a decision and optionally replay-safe thread reply, vote and resolution. */
export async function decide(client: PmClient, transport: GitHubTransport | undefined, input: VerdictInput): Promise<VerdictReceipt> {
  if (!input.reason.trim()) throw new Error('A nonempty --reason is required');
  if (input.commit && !/^[a-f0-9]{7,40}$/i.test(input.commit)) throw new Error('--commit must be a Git commit SHA');
  const item = (await reviewItems(client)).find(/** Only imported typed findings accept review decisions. */ candidate => candidate.id === input.id);
  if (!item) throw new Error('Review item not found; import this PR first');
  if (item.review_repo !== input.repo || item.review_pr !== input.pr) throw new Error('The item belongs to a different repository or PR');
  const receipt: VerdictReceipt = { item: item.id, verdict: input.verdict, applied: false, replied: false, reacted: false, resolved: false };
  if (!input.apply) {
    await recordVerdict(client, item, input.verdict, input.reason, input.commit);
    return receipt;
  }
  if (item.review_kind !== 'thread') throw new Error('--apply requires a thread finding; review and issue-comment verdicts are local');
  if (!transport) throw new Error('GitHub transport is required for --apply');
  const snapshot = await transport.snapshot(input.repo, input.pr);
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
  const reaction = input.verdict === 'refuse' ? 'THUMBS_DOWN' : input.verdict === 'fix' || input.verdict === 'informational' ? 'THUMBS_UP' : undefined;
  if (reaction && !source.reactions.some(/** Existing reactions from other users do not satisfy the applying account. */ existing => existing.user.toLowerCase() === viewer.toLowerCase() && existing.content === reaction)) {
    await transport.react(source.id, reaction);
    receipt.reacted = true;
  }
  if (!thread.resolved) {
    await transport.resolve(thread.id);
    receipt.resolved = true;
  }
  await client.update(item.id, fieldOptions({ review_resolved: true }));
  receipt.applied = true;
  return receipt;
}
