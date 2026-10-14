import type { Contribution, Finding, FindingKind, PullRequest, ReviewThread } from './types.ts';

/** Recognize bot noise that provides context without requesting a code change. */
export function isInformational(body: string): boolean {
  // Collapse whitespace once, then bound every optional marker separator. Adjacent
  // whitespace stars on untrusted bodies otherwise explore quadratic partitions.
  if (/critical|major|minor|high|medium|low/iu.test(body)) {
    const markers = body.replace(/\s+/gu, ' ');
    if (/\*{2} ?[🔴🟠🟡🔵]? ?(?:critical|major|minor|high|medium|low) ?\*{2}|_ ?[🔴🟠🟡] ?(?:critical|major|minor)_|\bseverity ?[:=] ?(?:critical|high|medium|low|major|minor)\b/iu.test(markers)) return false;
  }
  if (/(?:^|[\s_*])potential issue(?:$|[\s_*])|_nitpick_|nitpick comments \(\d+\)|outside diff range comments \(\d+\)|refactor suggestion|!\[(?:high|medium|low)[-_]priority\]/iu.test(body)) return false;
  return /(?:✅ )?action performed|summary by coderabbit|rate[- ]limit|quota (?:exceeded|exhausted)|trial (?:has )?ended|review failed|action not completed|no access to (?:this repository|reviews)|failed to (?:review|generate)|full review finished|walkthrough|no actionable (?:comments|issues)|actionable comments posted:|review skipped|summary of (?:changes|pull request)|you've used your own review budget|(?:^|\n)(?:Sorry [^\n,]+,\s*)?your (?:pull request is larger than the review limit|private repo does not have access)|(?:^|\n)[>\t ]*\d+ files exceed the limit of 100\b|(?:^|\n)[>\t ]*(?:You are seeing this message because GitHub Code Scanning has recently been set up|this pull request contains the workflow file for the Code Scanning tool)|(?:^|\n)[>\t ]*(?:no access\b|you (?:do not|don't) have access\b)|does not receive automatic reviews|reviewer's guide/i.test(body);
}

/** Distinguish unavailable or incomplete review notices from useful review summaries. */
export function isReviewNotice(body: string): boolean {
  return isInformational(body) && /rate[- ]limit|quota (?:exceeded|exhausted)|trial (?:has )?ended|review failed|failed to (?:review|generate)|review skipped|action not completed|no access|(?:do|does) not have access|don't have access|does not receive automatic reviews|review budget|larger than the review limit|files exceed the limit of 100/i.test(body);
}

/** Extract explicit severity markers used by CodeRabbit, Greptile, Gemini and Sourcery. */
export function severityOf(body: string): string {
  if (!/critical|major|minor|high|medium|low/iu.test(body)) return 'unknown';
  const markers = body.replace(/\s+/gu, ' ');
  const marked = markers.match(/(?:[🔴🟠🟡] ?|severity ?[:=] ?|priority[ _-]*(?:[:=] ?)?)(critical|high|medium|low|major|minor)/iu)
    ?? markers.match(/(?:_ ?[🟠🟡🔵] ?|\[ ?)(critical|high|medium|low|major|minor)/iu)
    ?? body.match(/(?:\/|\b)(high|medium|low)[-_]priority(?:\.|\b)/i);
  if (!marked) return 'unknown';
  const level = marked[1].toLowerCase();
  if (level === 'major') return 'high';
  if (level === 'minor') return 'low';
  return level;
}

/** Remove complete or truncated tag wrappers and trim Markdown markers in one pass. */
function plainTitleLine(line: string): string {
  let inTag = false;
  const characters: string[] = [];
  for (const character of line) {
    if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
    else if (!inTag) characters.push(character);
  }
  const text = characters.join('');
  let start = 0;
  let end = text.length;
  while (start < end && /[\s#>*_-]/u.test(text[start])) start++;
  while (end > start && /[\s*_]/u.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Choose a readable plain-text title; retain the unabridged body separately. */
export function summaryOf(body: string): string {
  const raw = body.split('\n');
  const lines = raw.map(plainTitleLine);
  /** Prefer substantial text over severity, diff headers and bot wrapper labels. */
  const eligible = (line: string): boolean => line.length > 0 && !/^[`!]|^\[!|potential issue|nitpick|(?:🔴|🟠|🟡|🔵)\s*(critical|major|minor)|^---|^\||^(?:critical|high|medium|low|major|minor)$|supported by static analysis|prompt for ai agents/i.test(line);
  const heading = lines.find(/** Actionable bold headings outrank preceding static-analysis script receipts. */ (line, index) => eligible(line) && raw[index].trimStart().startsWith('**'));
  const title = heading ?? lines.find(eligible);
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
