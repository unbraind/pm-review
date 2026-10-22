import { createHash } from 'node:crypto';
import { scoreItemSimilarity } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';

/** Stable validation failures shared by the SDK and CLI. */
export type LineageCode = 'finding_missing' | 'link_invalid' | 'revision_changed' | 'reason_required' | 'lineage_invalid' | 'disposition_conflict';
/** Explicit pair selection; omitted confirmation is always a read-only proposal. */
export interface LineageOptions { with?: string; confirm?: boolean; revision?: string; reason?: string }
/** Small result keeps bodies and historic reasoning available through ordinary PM reads. */
export interface LineageView {
  ok: true; id: string; canonical: string; revision: string;
  disposition: { verdict: string; reason: string; commit: string };
  observations: { id: string; provider: string; revision: string; url: string; withdrawn: boolean }[];
  proposal?: { with: string; canonical: string; score: number; reason: string; confirmed: boolean };
}
/** Typed refusals include a concrete next action instead of requiring prose parsing. */
export type LineageResult = LineageView | { ok: false; id: string; refusal: { code: LineageCode; remedy: string } };
/** Confirmation records are append-only PM comments, separate from candidate relationships. */
const PREFIX = 'review-lineage/v1 ';
/** Remedies are kept independent of observation text and provider output. */
const REMEDIES: Record<LineageCode, string> = {
  finding_missing: 'Import both observations first and select existing ReviewFinding item ids.',
  link_invalid: 'Supply --with with a different ReviewFinding item id; confirmation also requires that selector.',
  revision_changed: 'Read the pair proposal again and confirm its current --revision hash.',
  reason_required: 'Supply --reason with 12 to 1000 characters explaining why these observations describe one finding.',
  lineage_invalid: 'Inspect review-lineage/v1 comments with pm comments and correct the malformed record using core comment controls.',
  disposition_conflict: 'Record the intended verdict, reason and commit on the proposed canonical item before confirming; prior reasoning remains in history.',
};

/** Construct a stable refusal without throwing for expected agent input errors. */
function denied(id: string, code: LineageCode): LineageResult {
  return { ok: false, id, refusal: { code, remedy: REMEDIES[code] } };
}

/** Read raw complete review observations without applying their canonical dispositions. */
export async function lineageItems(client: PmClient): Promise<ItemMetadata[]> {
  return (await client.listAllComplete()).items.filter(/** Exclude ordinary tasks and candidate-only relationships. */ item => item.type === 'ReviewFinding');
}

/** Build deterministic connected components from explicit, attributable confirmations only. */
export function lineageGroups(items: ItemMetadata[]): Map<string, string> {
  const roots = new Map(items.map(/** Every imported observation initially has its own disposition. */ item => [item.id, item.id]));
  /** Resolve a representative; union always points towards the lexical minimum. */
  const root = (id: string): string => {
    let current = id;
    while (roots.get(current) !== current) current = roots.get(current)!;
    return current;
  };
  for (const item of items) for (const comment of item.comments ?? []) {
    if (!comment.text.startsWith(PREFIX)) continue;
    const record: unknown = JSON.parse(comment.text.slice(PREFIX.length));
    if (typeof record !== 'object' || record === null) throw new Error('Invalid lineage record');
    const row = record as Record<string, unknown>;
    if (typeof row.with !== 'string' || !roots.has(row.with) || row.with === item.id || typeof row.revision !== 'string' || !/^[a-f0-9]{64}$/.test(row.revision) || typeof row.reason !== 'string' || row.reason.trim().length < 12 || row.reason.length > 1000 || !comment.author.trim() || !comment.created_at.trim()) throw new Error('Invalid lineage record');
    const pair = [root(item.id), root(row.with)].sort();
    roots.set(pair[1], pair[0]);
  }
  return new Map(items.map(/** Flatten representatives so read and write paths agree. */ item => [item.id, root(item.id)]));
}

/** Read a source's own recorded disposition before any group projection. */
function disposition(item: ItemMetadata): LineageView['disposition'] {
  return { verdict: String(item.review_verdict ?? 'pending'), reason: String(item.review_reason ?? ''), commit: String(item.review_commit ?? '') };
}

/** Project a single disposition onto all confirmed observations for round and response consumers. */
export function canonicalReviewItems(items: ItemMetadata[]): ItemMetadata[] {
  const groups = lineageGroups(items);
  const byId = new Map(items.map(/** Preserve the unprojected canonical source. */ item => [item.id, item]));
  return items.map(/** Observation identity, body and provider remain distinct. */ item => {
    const canonical = byId.get(groups.get(item.id)!)!;
    return { ...item, review_canonical: canonical.id, review_verdict: canonical.review_verdict, review_reason: canonical.review_reason, review_commit: canonical.review_commit, review_verdict_source: canonical.review_verdict_source };
  });
}

/** Read or explicitly confirm cross-provider lineage without Git or provider network operations. */
export async function findingLineage(client: PmClient, id: string, options: LineageOptions = {}): Promise<LineageResult> {
  const items = await lineageItems(client);
  const item = items.find(/** Only persisted review observations can enter a lineage. */ row => row.id === id);
  const other = items.find(/** An explicit candidate can come from core duplicates or pm-jev. */ row => row.id === options.with);
  if (!item || (options.with !== undefined && !other)) return denied(id, 'finding_missing');
  if (options.with === id || (options.confirm && !other)) return denied(id, 'link_invalid');
  let groups: Map<string, string>;
  try { groups = lineageGroups(items); } catch { return denied(id, 'lineage_invalid'); }
  const canonical = groups.get(id)!;
  const selected = new Set([canonical, ...(other ? [groups.get(other.id)!] : [])]);
  const members = items.filter(/** Include both complete groups in the proposal revision. */ row => selected.has(groups.get(row.id)!)).sort(/** Stable ordering makes confirmation hashes portable across backends. */ (a, b) => a.id.localeCompare(b.id));
  const revision = createHash('sha256').update(JSON.stringify(members.map(/** Source edits, group changes and disposition changes invalidate proposals. */ row => [row.id, groups.get(row.id), row.description, row.review_bot, row.review_node_id, row.review_repo, row.review_pr, row.review_head, row.review_url, row.review_kind, row.review_thread_id, row.review_path, row.review_line, row.review_withdrawn, disposition(row)]))).digest('hex');
  const owner = items.find(/** One lexical representative owns the group's current disposition. */ row => row.id === canonical)!;
  const result: LineageView = { ok: true, id, canonical, revision, disposition: disposition(owner), observations: members.filter(/** A proposal never silently joins observations in the returned current group. */ row => groups.get(row.id) === canonical).map(/** Full text and previous decisions are available through pm get/history. */ row => ({ id: row.id, provider: String(row.review_bot ?? 'unknown'), revision: String(row.review_head ?? ''), url: String(row.review_url ?? ''), withdrawn: row.review_withdrawn === true })) };
  if (!other) return result;
  const proposed = [...selected].sort()[0];
  result.proposal = { with: other.id, canonical: proposed, ...scoreItemSimilarity(item.title, other.title), confirmed: canonical === groups.get(other.id) };
  if (!options.confirm || result.proposal.confirmed) return result;
  if (options.revision !== revision) return denied(id, 'revision_changed');
  const reason = options.reason ?? '';
  if (reason.trim().length < 12 || reason.length > 1000) return denied(id, 'reason_required');
  const next = items.find(/** Preview explicitly names which decision survives the confirmation. */ row => row.id === proposed)!;
  if (members.some(/** Never silently discard an independently recorded final decision. */ row => row.id === groups.get(row.id) && (row.review_verdict_source === 'local' || Boolean(row.review_reason) || Boolean(row.review_commit)) && JSON.stringify(disposition(row)) !== JSON.stringify(disposition(next)))) return denied(id, 'disposition_conflict');
  await client.comments(item.id, { add: PREFIX + JSON.stringify({ with: other.id, revision, reason }), ifAbsent: true });
  return findingLineage(client, id, { with: other.id });
}
