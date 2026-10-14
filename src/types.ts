/** Decisions retained as searchable review precedent across pull requests. */
export const VERDICTS = ['pending', 'fix', 'refuse', 'duplicate', 'stale', 'informational'] as const;
/** One persisted decision in the review vocabulary. */
export type Verdict = typeof VERDICTS[number];
/** GitHub bot contribution location, independent of its actionability. */
export type FindingKind = 'thread' | 'review' | 'comment';
/** A GitHub reaction with the account that actually cast it. */
export interface Reaction { content: string; user: string }
/** A fully paginated comment or review, including its original commit when available. */
export interface Contribution {
  id: string; bot: string; isBot: boolean; body: string; url: string; createdAt: string;
  head: string | null; reactions: Reaction[];
}
/** A line review thread with every reply retained for replay-safe application. */
export interface ReviewThread {
  id: string; path: string; line: number | null; resolved: boolean;
  comments: Contribution[];
}
/** A submitted PR review whose state and commit establish finished-review evidence. */
export interface Review extends Contribution { state: string }
/** One current-head check or legacy commit status normalized to a gate outcome. */
export interface Check { name: string; state: 'pass' | 'fail' | 'pending' }
/** One linked commit in the observed PR commit history. */
export interface Commit { sha: string; date: string; url: string }
/** Complete read-only snapshot; transports must reject truncation and changing heads. */
export interface PullRequest {
  repo: string; number: number; head: string; headDate: string; author: string;
  threads: ReviewThread[]; reviews: Review[]; comments: Contribution[];
  commits: Commit[]; checks: Check[];
}
/** Single network boundary; implementation owns all GitHub GraphQL and REST operations. */
export interface GitHubTransport {
  snapshot(repo: string, pr: number): Promise<PullRequest>;
  lifecycle(repo: string, pr: number, alerts: number[]): Promise<SourceLifecycle>;
  viewer(): Promise<string>;
  reply(thread: string, body: string): Promise<void>;
  react(node: string, content: 'THUMBS_UP' | 'THUMBS_DOWN'): Promise<void>;
  resolve(thread: string): Promise<void>;
}
/** Parsed bot contribution mapped to one durable GitHub node identity. */
export interface Finding extends Contribution {
  kind: FindingKind; thread: string; path: string; line: number | null;
  severity: string; summary: string; verdict: Verdict; resolved: boolean;
}

/** Live terminal source evidence, obtained only through read-only GitHub requests. */
export interface SourceLifecycle { merged: boolean; mergeCommit: string | null; alerts: { number: number; state: 'open' | 'fixed' | 'dismissed' | 'unknown' }[]; skippedAlerts?: { number: number; status: number }[] }
