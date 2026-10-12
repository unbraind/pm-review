import type { Contribution, Finding, FindingKind, PullRequest, ReviewThread } from './types.ts';

/** Recognize bot noise that provides context without requesting a code change. */
export function isInformational(body: string): boolean {
  if (/\bpotential issue\b|_nitpick_|!\[(?:high|medium|low)[-_]priority\]|\bseverity\s*[:=]\s*(?:critical|high|medium|low|major|minor)\b/iu.test(body)) return false;
  return /rate[- ]limit|quota (?:exceeded|exhausted)|trial (?:has )?ended|review failed|failed to (?:review|generate)|full review finished|walkthrough|no actionable (?:comments|issues)|actionable comments posted:|review skipped|summary of (?:changes|pull request)/i.test(body);
}

/** Extract explicit severity markers used by CodeRabbit, Greptile, Gemini and Sourcery. */
export function severityOf(body: string): string {
  const marked = body.match(/(?:🔴\s*|severity\s*[:=]\s*|priority[\s_-]*[:=]?\s*)(critical|high|medium|low|major|minor)/iu)
    ?? body.match(/(?:_\s*[🟠🟡🔵]\s*|\[\s*)(critical|high|medium|low|major|minor)/iu)
    ?? body.match(/(?:\/|\b)(high|medium|low)[-_]priority(?:\.|\b)/i);
  if (!marked) return 'unknown';
  const level = marked[1].toLowerCase();
  if (level === 'major') return 'high';
  if (level === 'minor') return 'low';
  return level;
}

/** Choose a readable finding title while retaining the unabridged body in the tracker. */
export function summaryOf(body: string): string {
  const lines = body.split('\n').map(/** Remove Markdown wrappers from candidate title lines. */ line => line.replace(/<[^>]*>/g, '').replace(/^[\s#>*_-]+|[\s*_]+$/g, '').trim());
  const title = lines.find(/** Prefer substantial text over severity and diff headers. */ line => line.length > 0 && !/^[`!]|potential issue|nitpick|(?:🔴|🟠|🟡|🔵)\s*(critical|major|minor)|^---|^\|/i.test(line));
  return (title ?? 'Bot review context').slice(0, 200);
}

/** Map an individual contribution into durable metadata without guessing a missing commit. */
function fromContribution(source: Contribution, kind: FindingKind): Finding {
  return { ...source, kind, thread: '', path: '', line: null, severity: severityOf(source.body), summary: summaryOf(source.body), verdict: isInformational(source.body) ? 'informational' : 'pending', resolved: false };
}

/** Select the first bot finding in a thread; subsequent replies remain available for apply deduplication. */
function fromThread(thread: ReviewThread): Finding[] {
  const source = thread.comments.find(/** Human-only threads are outside bot imports. */ comment => comment.isBot);
  if (!source) return [];
  return [{ ...fromContribution(source, 'thread'), id: thread.id, thread: thread.id, path: thread.path, line: thread.line, resolved: thread.resolved }];
}

/** Import one item per bot thread, nonempty bot review body and bot issue comment. */
export function findingsOf(pr: PullRequest): Finding[] {
  return [
    ...pr.threads.flatMap(fromThread),
    ...pr.reviews.filter(/** Empty submitted reviews establish completion but have no finding body. */ review => review.isBot && review.body.trim().length > 0).map(/** Preserve submitted-review identity separately from thread identity. */ review => fromContribution(review, 'review')),
    ...pr.comments.filter(/** All bot issue comments are durable context. */ comment => comment.isBot).map(/** Retain issue-comment identity and its unknown commit provenance. */ comment => fromContribution(comment, 'comment')),
  ];
}
