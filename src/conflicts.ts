import type { GetResult, ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { lineageGroups, lineageItems } from './lineage.ts';
import type { LineageIssue } from './lineage.ts';
import { requestSnapshot } from './requests-state.ts';
import type { RequestSnapshot } from './requests-state.ts';
import { requestNumbers } from './requests-validation.ts';
import { scopeDigest } from './scope-state.ts';
import { reviewTextExcerpt } from './output-budget.ts';
import { bounded, conflictInput, conflictRefusal, conflictScope, serializeConflictWitness } from './conflict-state.ts';
import type { ConflictPacket, ConflictResult } from './conflict-types.ts';

/** Select confirmed members only; malformed foreign edges remain attributable diagnostics. */
function members(items: ItemMetadata[], id: string): { rows: ItemMetadata[]; issues: number } {
  const issues: LineageIssue[] = [];
  const groups = lineageGroups(items, issues);
  const rows = items.filter(/** A source outside the confirmed component cannot vote on this finding. */ row => groups.get(row.id) === groups.get(id)).sort(/** Stable source order is independent of provider counts and decision time. */ (a, b) => a.id.localeCompare(b.id));
  const ids = new Set(rows.map(/** Diagnostics elsewhere in the tracker do not invalidate this packet. */ row => row.id));
  return { rows, issues: issues.filter(/** A dangling edge attached to this lineage is missing evidence. */ issue => ids.has(issue.id)).length };
}

/** Convert unavailable complete reads into typed data without leaking backend errors. */
async function observe(client: PmClient, id: string): Promise<ReturnType<typeof members> | undefined> {
  try { return members(await lineageItems(client), id); } catch { return undefined; }
}

/** Find opposed explicit judgments without canonical verdict projection, votes, writes or provider calls. */
export async function reviewConflicts(client: PmClient, input: unknown): Promise<ConflictResult> {
  const selection = conflictInput(input);
  if (!selection) return conflictRefusal('input_invalid');
  let selected: GetResult['item'];
  try { selected = (await client.get(selection.item, { full: true })).item; }
  catch { return conflictRefusal('finding_unavailable'); }
  if (selected.type !== 'ReviewFinding') return conflictRefusal('finding_unavailable');
  const scope = conflictScope(selected, selection.revision);
  if (!scope) return conflictRefusal('scope_unavailable');
  const first = await observe(client, selected.id);
  if (!first) return conflictRefusal('finding_unavailable');
  if (!first.rows.some(/** Deletion or retyping between reads cannot produce an empty successful packet. */ row => row.id === selected.id)) return conflictRefusal('state_changed');
  if (first.rows.length > 32) return conflictRefusal('lineage_too_large');
  if (scopeDigest(conflictScope(first.rows.find(/** Scope chosen by the operator cannot drift between the initial read and corpus acquisition. */ row => row.id === selected.id)!, selection.revision) ?? null) !== scopeDigest(scope)) return conflictRefusal('state_changed');
  const packet: ConflictPacket = { ok: true, schema: 'review-conflicts/v1', item: selected.id, scope, revision: '', state: 'no_opposition_observed', resolution: 'unverified', consistency: 'observed', judgments: [], skipped: [], lineage_issues: first.issues, missing: [
    { kind: 'core_decision', remedy: 'Locate or record an attributed core Plan decision selecting a disposition after assessing both source judgments at these audited versions.' },
    { kind: 'resolution_evidence', remedy: 'Attach evidence that addresses the incompatible reasoning at this exact artifact revision; provider counts and recency are not resolution evidence.' },
    { kind: 'review_availability', remedy: 'Verify current source availability independently; local observations, withdrawn reviews and missing reviews cannot establish resolution.' },
  ] };
  const snapshots: [string, RequestSnapshot | undefined][] = [];
  for (const row of first.rows) {
    const snapshot = await requestSnapshot(client, row.id);
    snapshots.push([row.id, snapshot]);
    const native = snapshot?.item ?? row;
    const nativeScope = bounded(native.review_head, 2048) ? conflictScope(native, native.review_head) : undefined;
    let reason: ConflictPacket['skipped'][number]['reason'] | undefined;
    if (!snapshot || !nativeScope) reason = 'source_unavailable';
    else if (scopeDigest(nativeScope) !== scopeDigest(scope)) reason = 'scope_mismatch';
    else if (!['fix', 'refuse'].includes(String(native.review_verdict)) || native.review_verdict_source === 'import' || typeof native.review_reason !== 'string' || !native.review_reason.trim()) reason = 'not_explicit';
    else if (!bounded(native.id, 512) || !bounded(native.review_node_id, 2048) || !bounded(native.review_bot, 256) || !bounded(native.review_provider ?? scope.kind, 256) || !bounded(native.review_url, 4096) || typeof native.review_commit !== 'string' && native.review_commit !== undefined || String(native.review_commit ?? '').length > 2048) reason = 'source_unavailable';
    if (reason) { packet.skipped.push({ item: row.id, reason }); continue; }
    const excerpt = reviewTextExcerpt(String(native.review_reason));
    packet.judgments.push({ item: row.id, version: snapshot!.version, node: String(native.review_node_id), provider: String(native.review_provider ?? scope.kind), reviewer: String(native.review_bot), url: String(native.review_url), verdict: native.review_verdict as 'fix' | 'refuse', reason: excerpt.text, reason_omitted: excerpt.omitted, commit: String(native.review_commit ?? ''), availability: native.review_withdrawn === true ? 'withdrawn' : 'observed' });
  }
  // No lock or shared journal is created: verify every audited revision and component again, including A-B-A edits.
  for (const [id, before] of snapshots) if (scopeDigest(await requestSnapshot(client, id) ?? null) !== scopeDigest(before ?? null)) return conflictRefusal('state_changed');
  if (scopeDigest(await observe(client, selected.id) ?? null) !== scopeDigest(first)) return conflictRefusal('state_changed');
  const opposed = packet.judgments.some(/** One supported fix is enough; no majority threshold exists. */ row => row.verdict === 'fix') && packet.judgments.some(/** One explicit refusal preserves opposition regardless of provider multiplicity. */ row => row.verdict === 'refuse');
  const incomplete = first.issues > 0 || packet.skipped.some(/** Pending and different-scope records cannot manufacture missing-source approval. */ row => row.reason === 'source_unavailable') || packet.judgments.some(/** Withdrawal never retires a recorded incompatible judgment. */ row => row.availability === 'withdrawn');
  const result: ConflictPacket = { ...packet, revision: scopeDigest([selection.schema, scope, snapshots]), state: opposed ? 'conflict' : incomplete ? 'insufficient_evidence' : 'no_opposition_observed' };
  if (!requestNumbers(result) || ['json', 'toon'].some(/** Bound both agent encodings, including escaping and Unicode. */ format => Buffer.byteLength(serializeConflictWitness(result, format as 'json' | 'toon')) > 65536)) return conflictRefusal('output_invalid');
  return result;
}
