import { createHash } from 'node:crypto';
import { isRuntimeRecord, PmCliError, splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import type { GetResult, PmClient } from '@unbrained/pm-cli/sdk';
import type { ScopeCode, ScopeRefusal, ScopeSelection } from './scope-types.ts';
import { parseScopeInput } from './scope-validation.ts';

/** Fixed remedies omit backend paths and preserve a compact machine-readable contract. */
const REMEDIES: Record<ScopeCode, string> = {
  scope_invalid: 'Use the documented scope schema with positive safe history versions, bounded strings, dense unique arrays and no extra keys; supply at most 32 obligations, 16 fields and 16 evidence items per obligation, within 1 MiB.',
  scope_unavailable: 'Supply one readable regular UTF-8 JSON scope file of at most 1 MiB.',
  history_unavailable: 'Select an existing item and verified durable history version; restore missing audited history or capture a new explicit scope.',
  criterion_unknown: 'Read the acceptance criteria at the selected version and choose its AC identifier.',
  field_unknown: 'Select an own native field present in the SDK full item at the reviewed version.',
  baseline_changed: 'Use an unchanged review scope receipt for this item; recapture explicit attention if its history or digests differ.',
  state_changed: 'A peer changed an observed item during comparison; read the new artifact and retry.',
};

/** Construct stable actionable data instead of leaking backend exceptions. */
export function scopeRefusal(code: ScopeCode): ScopeRefusal { return { ok: false, refusal: { code, remedy: REMEDIES[code] } }; }

/** Sort object keys only; SDK-owned string, array, relationship and whitespace semantics remain exact. */
export function scopeDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_key, entry: unknown) => isRuntimeRecord(entry) ? Object.fromEntries(Object.keys(entry).sort().map(/** Reordered object keys do not change native values. */ key => [key, entry[key]])) : entry)).digest('hex');
}

/** Validate declarations once with the shared producer and receipt schema. */
export function scopeSelection(value: unknown): ScopeSelection | undefined {
  return parseScopeInput(value, false);
}

/** Recover only validated selectors; receipt digests are subsequently checked against SDK history. */
export function selectionFromScope(value: unknown): ScopeSelection | undefined {
  const scope = parseScopeInput(value, true);
  if (!scope) return undefined;
  return { version: scope.version, author: scope.author, reason: scope.reason, obligations: scope.obligations.map(row => ({ criterion: row.criterion, judgment: row.judgment, fields: row.fields.map(field => field.name), evidence: row.evidence.map(source => ({ id: source.id, version: source.version })) })) };
}

/** Ask core to verify historical reconstruction; unavailable or corrupt records are typed refusals. */
export async function historicalItem(client: PmClient, id: string, version: number): Promise<GetResult['item'] | undefined> {
  try {
    return (await client.get(id, { full: true, at: String(version) })).item;
  } catch { /* A backend error cannot establish a reviewed historical artifact. */ }
  return undefined;
}

/** Match the criterion selectors already used by coverage and closeout. */
export function scopeCriteria(item: GetResult['item']): Map<string, string> {
  return new Map(splitAcceptanceCriteria(item.acceptance_criteria).map(/** Order changes conservatively invalidate affected AC identifiers. */ (text, index) => [`AC${index + 1}`, scopeDigest(text)]));
}


/** Detect any successor revision, including a replay that restores identical bytes and timestamps. */
export async function evidenceAdvanced(client: PmClient, id: string, version: number): Promise<boolean> {
  try { await client.get(id, { full: true, at: String(version + 1) }); }
  catch (failure) {
    // Only core's explicit end-of-history range proves this version is still the latest.
    return !(failure instanceof PmCliError && failure.code === 'history_target_out_of_range' && isRuntimeRecord(failure.context.valid_range) && failure.context.valid_range.last_version === version);
  }
  return true;
}
