import { createHash } from 'node:crypto';
import { scoreItemSimilarity } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { canonicalOf, decisionTime, disposition, LINEAGE_PREFIX, lineageGroups } from './lineage-state.ts';
/** Internal consumers share the same tolerant graph and decision-time projection. */
export { canonicalReviewItems, lineageGroups, lineageIssues } from './lineage-state.ts';

/** Stable validation failures shared by the SDK and CLI. */
export type LineageCode = 'finding_missing' | 'link_invalid' | 'revision_changed' | 'reason_required' | 'lineage_invalid' | 'disposition_conflict';
/** Explicit pair selection; omitted confirmation is always a read-only proposal. */
export interface LineageOptions { with?: string; confirm?: boolean; revision?: string; reason?: string }
/** An invalid edge is skipped and remains visible with an actionable diagnostic. */
export interface LineageIssue { id: string; comment: number; code: 'lineage_invalid'; kind: 'malformed' | 'dangling'; remedy: string }
/** Small result keeps bodies and historic reasoning available through ordinary PM reads. */
export interface LineageView {
  ok: true; id: string; canonical: string; revision: string;
  disposition: { verdict: string; reason: string; commit: string };
  observations: { id: string; provider: string; revision: string; url: string; withdrawn: boolean }[];
  issues?: LineageIssue[];
  disagreements?: { id: string; disposition: LineageView['disposition']; decision_time: number }[];
  proposal?: { with: string; canonical: string; score: number; reason: string; confirmed: boolean };
}
/** Typed refusals include a concrete next action instead of requiring prose parsing. */
export type LineageResult = LineageView | { ok: false; id: string; refusal: { code: LineageCode; remedy: string } };
/** Remedies are kept independent of observation text and provider output. */
const REMEDIES: Record<LineageCode, string> = {
  finding_missing: 'Import both observations first and select existing ReviewFinding item ids.',
  link_invalid: 'Supply --with with a different ReviewFinding item id; confirmation also requires that selector.',
  revision_changed: 'Read the pair proposal again and confirm its current --revision hash.',
  reason_required: 'Supply --reason with 12 to 1000 characters explaining why these observations describe one finding.',
  lineage_invalid: 'Inspect review-lineage/v1 comments with pm comments and correct the malformed record using core comment controls.',
  disposition_conflict: 'Reassess both independent decisions and record the same intended verdict, reason and commit on each root before confirming; retain prior reasoning in history.',
};

/** Construct a stable refusal without throwing for expected agent input errors. */
function denied(id: string, code: LineageCode): LineageResult {
  return { ok: false, id, refusal: { code, remedy: REMEDIES[code] } };
}

/** Read raw complete review observations without applying their canonical dispositions. */
export async function lineageItems(client: PmClient): Promise<ItemMetadata[]> {
  return (await client.listAllComplete()).items.filter(/** Exclude ordinary tasks and candidate-only relationships. */ item => item.type === 'ReviewFinding');
}

/** Read or explicitly confirm cross-provider lineage without Git or provider network operations. */
export async function findingLineage(client: PmClient, id: string, options: LineageOptions = {}): Promise<LineageResult> {
  const items = await lineageItems(client);
  const item = items.find(/** Only persisted review observations can enter a lineage. */ row => row.id === id);
  const other = items.find(/** An explicit candidate can come from core duplicates or pm-jev. */ row => row.id === options.with);
  if (!item || (options.with !== undefined && !other)) return denied(id, 'finding_missing');
  if (options.with === id || (options.confirm && !other)) return denied(id, 'link_invalid');
  const issues: LineageIssue[] = [];
  const groups = lineageGroups(items, issues);
  const canonical = groups.get(id)!;
  const selected = new Set([canonical, ...(other ? [groups.get(other.id)!] : [])]);
  const members = items.filter(/** Include both complete groups in the proposal revision. */ row => selected.has(groups.get(row.id)!)).sort(/** Stable ordering makes confirmation hashes portable across backends. */ (a, b) => a.id.localeCompare(b.id));
  const revision = createHash('sha256').update(JSON.stringify(members.map(/** Source edits, group changes and disposition changes invalidate proposals. */ row => [row.id, groups.get(row.id), row.title, row.description, row.comments, row.review_decided_at, row.review_bot, row.review_node_id, row.review_repo, row.review_pr, row.review_head, row.review_url, row.review_kind, row.review_thread_id, row.review_path, row.review_line, row.review_withdrawn, disposition(row)]))).digest('hex');
  const owner = items.find(/** The most recently recorded decision owns the current group. */ row => row.id === canonical)!;
  const result: LineageView = { ok: true, id, canonical, revision, disposition: disposition(owner), observations: members.filter(/** A proposal never silently joins observations in the returned current group. */ row => groups.get(row.id) === canonical).map(/** Full text and previous decisions are available through pm get/history. */ row => ({ id: row.id, provider: String(row.review_bot ?? 'unknown'), revision: String(row.review_head ?? ''), url: String(row.review_url ?? ''), withdrawn: row.review_withdrawn === true })) };
  if (issues.length) result.issues = issues;
  const disagreements = members.filter(/** Expose retained observations whose original decisions differ from the effective one. */ row => groups.get(row.id) === canonical && JSON.stringify(disposition(row)) !== JSON.stringify(result.disposition)).map(/** Historical disagreements remain inspectable after replayed or reverse links. */ row => ({ id: row.id, disposition: disposition(row), decision_time: decisionTime(row) }));
  if (disagreements.length) result.disagreements = disagreements;
  if (!other) return result;
  const roots = items.filter(/** Compare every selected root, regardless of where its verdict originated. */ row => selected.has(row.id));
  const proposed = canonicalOf(roots).id;
  result.proposal = { with: other.id, canonical: proposed, ...scoreItemSimilarity(item.title, other.title), confirmed: canonical === groups.get(other.id) };
  if (!options.confirm || result.proposal.confirmed) return result;
  if (options.revision !== revision) return denied(id, 'revision_changed');
  const reason = options.reason ?? '';
  if (reason.trim().length < 12 || reason.length > 1000) return denied(id, 'reason_required');
  if (new Set(roots.map(/** Import-derived decisions are just as material as explicit local decisions. */ row => JSON.stringify(disposition(row)))).size > 1) return denied(id, 'disposition_conflict');
  await client.comments(item.id, { add: LINEAGE_PREFIX + JSON.stringify({ with: other.id, revision, reason }), ifAbsent: true });
  return findingLineage(client, id, { with: other.id });
}
