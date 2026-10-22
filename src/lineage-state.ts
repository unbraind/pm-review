import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { LineageIssue, LineageView } from './lineage.ts';

/** Versioned confirmation comments are distinct from candidate relationships. */
export const LINEAGE_PREFIX = 'review-lineage/v1 ';
/** One validated, explicit identity confirmation. */
interface Confirmation { with: string; revision: string; reason: string }

/** Retain complete disposition evidence when comparing independently decided roots. */
export function disposition(item: ItemMetadata): LineageView['disposition'] {
  return { verdict: String(item.review_verdict ?? 'pending'), reason: String(item.review_reason ?? ''), commit: String(item.review_commit ?? '') };
}

/** The same stable audit text is used for atomic writes and legacy decision dating. */
export function decisionText(value: LineageView['disposition']): string {
  return `pm-review ${value.verdict}: ${value.reason}${value.commit ? `\nCommit: ${value.commit}` : ''}`;
}

/** Date the current decision, without allowing confirmation or title edits to advance it. */
export function decisionTime(item: ItemMetadata): number {
  let timestamp = Date.parse(String(item.review_decided_at ?? item.created_at)) || 0;
  const text = decisionText(disposition(item));
  for (const comment of item.comments ?? []) if (comment.text === text) timestamp = Math.max(timestamp, Date.parse(comment.created_at) || 0);
  return timestamp;
}

/** Latest decision wins; ids break only equal-time ties deterministically. */
export function canonicalOf(items: ItemMetadata[]): ItemMetadata {
  return [...items].sort(/** Decision time, rather than transport-derived id order, owns a group's disposition. */ (a, b) => decisionTime(b) - decisionTime(a) || a.id.localeCompare(b.id))[0];
}

/** Reject invalid confirmation payloads without making the corpus unreadable. */
function confirmationOf(value: unknown): Confirmation | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.with !== 'string' || typeof row.revision !== 'string' || !/^[a-f0-9]{64}$/.test(row.revision) || typeof row.reason !== 'string' || row.reason.trim().length < 12 || row.reason.length > 1000) return undefined;
  return row as unknown as Confirmation;
}

/** Build valid connected components while reporting malformed, deleted and retyped targets. */
export function lineageGroups(items: ItemMetadata[], issues: LineageIssue[] = []): Map<string, string> {
  const roots = new Map(items.map(/** Each observation initially stands alone. */ item => [item.id, item.id]));
  /** Resolve the internal component label; canonical ownership is selected separately. */
  const root = (id: string): string => {
    let current = id;
    while (roots.get(current) !== current) current = roots.get(current)!;
    return current;
  };
  for (const item of items) for (const [index, comment] of (item.comments ?? []).entries()) {
    if (!comment.text.startsWith(LINEAGE_PREFIX)) continue;
    let row: Confirmation | undefined;
    try { row = confirmationOf(JSON.parse(comment.text.slice(LINEAGE_PREFIX.length))); } catch { /* Bad records are diagnostics, never a corpus-wide exception. */ }
    const malformed = !row || row.with === item.id || !comment.author.trim() || !comment.created_at.trim();
    if (malformed || !roots.has(row!.with)) {
      issues.push({ id: item.id, comment: index + 1, code: 'lineage_invalid', kind: malformed ? 'malformed' : 'dangling', remedy: 'Inspect this confirmation with pm comments; correct its payload or restore the referenced ReviewFinding. The invalid edge was skipped; its audit history remains.' });
      continue;
    }
    const pair = [root(item.id), root(row!.with)].sort();
    roots.set(pair[1], pair[0]);
  }
  const components = new Map<string, ItemMetadata[]>();
  for (const item of items) {
    const key = root(item.id);
    const members = components.get(key) ?? [];
    members.push(item);
    components.set(key, members);
  }
  const owners = new Map([...components].map(/** Component labels are not disposition owners. */ ([id, members]) => [id, canonicalOf(members).id]));
  return new Map(items.map(/** Expose decision-time ownership consistently to every consumer. */ item => [item.id, owners.get(root(item.id))!]));
}

/** Collect actionable confirmation diagnostics without mutating observations. */
export function lineageIssues(items: ItemMetadata[]): LineageIssue[] {
  const issues: LineageIssue[] = [];
  lineageGroups(items, issues);
  return issues;
}

/** Project one current decision while leaving each observation's audit and identity intact. */
export function canonicalReviewItems(items: ItemMetadata[]): ItemMetadata[] {
  const issues: LineageIssue[] = [];
  const groups = lineageGroups(items, issues);
  const byId = new Map(items.map(/** Canonical state always comes from a raw observation. */ item => [item.id, item]));
  return items.map(/** Only the effective decision is shared, never the source identity or body. */ item => {
    const canonical = byId.get(groups.get(item.id)!)!;
    const diagnostics = issues.filter(/** Keep a bad edge attributable to its actual comment. */ issue => issue.id === item.id);
    return { ...item, review_canonical: canonical.id, review_verdict: canonical.review_verdict, review_reason: canonical.review_reason, review_commit: canonical.review_commit, review_verdict_source: canonical.review_verdict_source, ...(diagnostics.length ? { review_lineage_issues: diagnostics } : {}) };
  });
}
