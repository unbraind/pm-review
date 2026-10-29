import type { GetResult, PmClient } from '@unbrained/pm-cli/sdk';
import type { CarryForwardReport, CarryForwardResult, ScopeResult, ReviewScope, ScopeSelection, ScopeRefusal } from './scope-types.ts';
import { validScopeNumbers } from './scope-validation.ts';
import { evidenceAdvanced, historicalItem, scopeCriteria, scopeDigest, scopeRefusal, scopeSelection, selectionFromScope } from './scope-state.ts';

/** Capture explicitly declared review attention at verified historical versions, without modifying the tracker. */
export async function captureReviewScope(client: PmClient, id: string, input: unknown): Promise<ScopeResult> {
  const selection = scopeSelection(input);
  if (!selection) return scopeRefusal('scope_invalid');
  return captureSelectedScope(client, id, selection);
}

/** Reconstruct already validated selectors without another input validation or a second normalization path. */
async function captureSelectedScope(client: PmClient, id: string, selection: ScopeSelection): Promise<ScopeResult> {
  const item = await historicalItem(client, id, selection.version);
  if (!item) return scopeRefusal('history_unavailable');
  const criteria = scopeCriteria(item);
  const receipt: ReviewScope = { ok: true, schema: 'review-scope/v1', id: item.id, version: selection.version, author: selection.author, reason: selection.reason, artifact: scopeDigest(item), obligations: [] };
  for (const row of selection.obligations) {
    if (!criteria.has(row.criterion)) return scopeRefusal('criterion_unknown');
    if (row.fields.some(/** A missing field is different from a present empty field. */ name => !Object.hasOwn(item, name))) return scopeRefusal('field_unknown');
    const evidence: ReviewScope['obligations'][number]['evidence'] = [];
    for (const source of row.evidence) {
      const original = await historicalItem(client, source.id, source.version);
      if (!original) return scopeRefusal('history_unavailable');
      evidence.push({ id: original.id, version: source.version, digest: scopeDigest(original) });
    }
    receipt.obligations.push({ criterion: row.criterion, digest: criteria.get(row.criterion)!, judgment: row.judgment, fields: row.fields.map(/** Hash exact SDK values including collections and native relationship attributes. */ name => ({ name, digest: scopeDigest(item[name]) })), evidence });
  }
  return checkedScopeResult(receipt);
}

/** Read only explicitly referenced current items; foreign tracker records are outside this scope. */
async function observe(client: PmClient, ids: string[]): Promise<Map<string, GetResult['item'] | undefined>> {
  const observed = new Map<string, GetResult['item'] | undefined>();
  for (const id of ids) {
    try { observed.set(id, (await client.get(id, { full: true })).item); }
    catch { observed.set(id, undefined); }
  }
  return observed;
}

/** Compare a replayable receipt with current native state; retained attention is always independent of approval. */
export async function carryForwardReview(client: PmClient, id: string, baseline: unknown): Promise<CarryForwardResult> {
  const selection = selectionFromScope(baseline);
  if (!selection) return scopeRefusal('scope_invalid');
  const original = await captureSelectedScope(client, id, selection);
  if (!original.ok) return original;
  if (scopeDigest(baseline) !== scopeDigest(original)) return scopeRefusal('baseline_changed');
  const scope = original;
  const ids = [...new Set([scope.id, ...scope.obligations.flatMap(/** Shared evidence is read once per observation pass. */ row => row.evidence.map(/** Evidence identity is separate from artifact identity. */ source => source.id))])];
  const current = await observe(client, ids);
  const advanced = new Map<string, boolean>();
  for (const row of scope.obligations) for (const source of row.evidence) advanced.set(JSON.stringify(source), await evidenceAdvanced(client, source.id, source.version));
  const checked = await observe(client, [...ids].reverse());
  for (const key of ids) if (scopeDigest(current.get(key) ?? null) !== scopeDigest(checked.get(key) ?? null)) return scopeRefusal('state_changed');
  // Recheck monotonic evidence history after the final byte reads: imports may restore old bytes.
  for (const row of scope.obligations) for (const source of row.evidence) if (advanced.get(JSON.stringify(source)) !== await evidenceAdvanced(client, source.id, source.version)) return scopeRefusal('state_changed');
  const item = current.get(scope.id);
  if (!item) return scopeRefusal('scope_unavailable');
  const criteria = scopeCriteria(item);
  const report: CarryForwardReport = { ok: true, id: scope.id, from: scope.version, artifact: scopeDigest(item), artifact_changed: scope.artifact !== scopeDigest(item), approval: 'unverified', consistency: 'observed', counts: { unchanged: 0, stale: 0, never_reviewed: 0, removed: 0 }, obligations: [] };
  const prior = new Map(scope.obligations.map(/** Baseline includes only explicit assessments, never inferred coverage. */ row => [row.criterion, row]));
  for (const [criterion, digest] of criteria) {
    const before = prior.get(criterion);
    const reasons: string[] = [];
    if (before) {
      if (before.digest !== digest) reasons.push('criterion_changed');
      for (const field of before.fields) if (!Object.hasOwn(item, field.name) || scopeDigest(item[field.name]) !== field.digest) reasons.push(`field_changed:${field.name}`);
      for (const source of before.evidence) if (advanced.get(JSON.stringify(source)) || scopeDigest(current.get(source.id) ?? null) !== source.digest) reasons.push(`evidence_changed:${source.id}`);
    }
    const state = !before || before.judgment === 'gap' ? 'never_reviewed' : reasons.length > 0 ? 'stale' : 'unchanged';
    report.obligations.push({ criterion, state, reasons });
    report.counts[state]++;
  }
  for (const before of scope.obligations) if (!criteria.has(before.criterion)) {
    report.obligations.push({ criterion: before.criterion, state: 'removed', reasons: ['criterion_removed'] });
    report.counts.removed++;
  }
  return checkedScopeResult(report);
}

/** Refuse invalid emitted numbers before exposing any successful scope result. */
export function checkedScopeResult<T extends ReviewScope | CarryForwardReport>(value: T): T | ScopeRefusal {
  return validScopeNumbers(value) ? value : scopeRefusal('scope_invalid');
}
