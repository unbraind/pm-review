import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import { findingsOf } from './findings.ts';
import type { Contribution, PullRequest } from './types.ts';

/** Exact-head gate receipt retains each missing piece of review evidence. */
export interface RoundReceipt {
  repo: string; pr: number; head: string; complete: boolean;
  checks: 'pass' | 'fail' | 'pending'; coderabbit_finished: boolean;
  unresolved_threads: string[]; unvoted_bot_comments: string[];
  pending_items: string[]; unimported_nodes: string[];
}

/** Reject notices and pending/dismissed reviews as finished CodeRabbit evidence. */
function coderabbitFinished(pr: PullRequest): boolean {
  const isRabbit = (comment: Contribution): boolean => comment.isBot && /^coderabbitai(?:\[bot\])?$/i.test(comment.bot);
  return pr.reviews.some(/** Completion requires a submitted review tied to the exact current commit. */ review => isRabbit(review) && review.head === pr.head && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state) && !/review failed|rate[- ]limit|review skipped|trial (?:has )?ended/i.test(review.body));
}

/** Collect all nonempty bot comments; every reaction must come from the PR author account. */
export function botComments(pr: PullRequest): Contribution[] {
  return [...pr.comments, ...pr.threads.flatMap(/** Thread replies count independently when checking author votes. */ thread => thread.comments), ...pr.reviews].filter(/** Empty review objects need completion evidence, without inventing a comment to vote on. */ comment => comment.isBot && comment.body.trim().length > 0);
}

/** Compute completion from current GitHub evidence and complete tracker state, never cached resolved fields. */
export function evaluateRound(pr: PullRequest, items: ItemMetadata[]): RoundReceipt {
  const scoped = items.filter(/** Decisions from another PR cannot satisfy this review round. */ item => item.review_repo === pr.repo && item.review_pr === pr.number);
  const nodes = new Set(findingsOf(pr).map(/** Current source nodes bound pending and import completeness. */ finding => finding.id));
  const checks = pr.checks.some(/** Failed checks dominate pending checks. */ check => check.state === 'fail') ? 'fail' : pr.checks.length > 0 && pr.checks.every(/** Missing, skipped and neutral checks cannot count as green evidence. */ check => check.state === 'pass') ? 'pass' : 'pending';
  const coderabbit_finished = coderabbitFinished(pr);
  const unresolved_threads = pr.threads.filter(/** Every unresolved thread, including human review, blocks landing. */ thread => !thread.resolved).map(/** Expose identities for deterministic follow-up. */ thread => thread.id);
  const unvoted_bot_comments = botComments(pr).filter(/** Any author reaction is a vote; another account's vote never substitutes. */ comment => !comment.reactions.some(/** Compare GitHub logins case-insensitively. */ reaction => reaction.user.toLowerCase() === pr.author.toLowerCase())).map(/** Retain each source comment identity. */ comment => comment.id);
  const pending_items = scoped.filter(/** Existing decisions remain active across head changes while the finding still exists. */ item => nodes.has(String(item.review_node_id)) && item.review_verdict === 'pending').map(/** Item ids can be passed directly to verdict. */ item => item.id);
  const imported = new Set(scoped.map(/** Import provenance establishes coverage of this PR's current context. */ item => String(item.review_node_id)));
  const unimported_nodes = [...nodes].filter(/** A clean empty tracker is insufficient evidence of a completed import. */ node => !imported.has(node));
  return { repo: pr.repo, pr: pr.number, head: pr.head, complete: checks === 'pass' && coderabbit_finished && unresolved_threads.length === 0 && unvoted_bot_comments.length === 0 && pending_items.length === 0 && unimported_nodes.length === 0, checks, coderabbit_finished, unresolved_threads, unvoted_bot_comments, pending_items, unimported_nodes };
}

/** Render one stable script line while JSON callers retain the full structured receipt. */
export function compactRound(result: RoundReceipt): string {
  return `review ${result.repo}#${result.pr} head=${result.head} complete=${result.complete} checks=${result.checks} coderabbit=${result.coderabbit_finished ? 'finished' : 'missing'} unresolved=${result.unresolved_threads.length} unvoted=${result.unvoted_bot_comments.length} pending=${result.pending_items.length} unimported=${result.unimported_nodes.length}`;
}
