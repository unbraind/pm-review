import { createHash } from 'node:crypto';
import { isRuntimeRecord, PmCliError } from '@unbrained/pm-cli/sdk';
import type { GetResult, PmClient } from '@unbrained/pm-cli/sdk';
import type { ScopeCode, ScopeRefusal, ScopeSelection } from './scope-types.ts';

/** Fixed remedies omit backend paths and preserve a compact machine-readable contract. */
const REMEDIES: Record<ScopeCode, string> = {
  scope_invalid: 'Use review scope with a positive history version, author, reason, and at most 32 unique AC obligations; each needs 1-16 unique native fields and at most 16 versioned evidence items.',
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

/** Version selectors are durable numbers, never content-only identities or moving timestamps. */
function versioned(value: unknown): value is { id: string; version: number } {
  return isRuntimeRecord(value) && typeof value.id === 'string' && value.id.length > 0 && Number.isSafeInteger(value.version) && Number(value.version) > 0;
}

/** Validate untrusted SDK and CLI selections before performing any backend reads. */
export function scopeSelection(value: unknown): ScopeSelection | undefined {
  if (!isRuntimeRecord(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || typeof value.author !== 'string' || !value.author.trim() || value.author.length > 200 || typeof value.reason !== 'string' || value.reason.trim().length < 12 || value.reason.length > 1000 || !Array.isArray(value.obligations) || value.obligations.length > 32) return undefined;
  const criteria = new Set<string>();
  for (const row of value.obligations) {
    if (!isRuntimeRecord(row) || typeof row.criterion !== 'string' || !/^AC[1-9]\d*$/.test(row.criterion) || criteria.has(row.criterion) || (row.judgment !== 'reviewed' && row.judgment !== 'gap') || !Array.isArray(row.fields) || row.fields.length < 1 || row.fields.length > 16 || !row.fields.every(/** Own field names cannot invoke inherited properties. */ (name: unknown) => typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name)) || new Set(row.fields).size !== row.fields.length || !Array.isArray(row.evidence) || row.evidence.length > 16 || !row.evidence.every(versioned) || new Set(row.evidence.map(/** One source item has one reviewed version per obligation. */ source => source.id)).size !== row.evidence.length) return undefined;
    criteria.add(row.criterion);
  }
  return value as unknown as ScopeSelection;
}

/** Recover capture selectors from a receipt; the entire receipt is subsequently checked against SDK history. */
export function selectionFromScope(value: unknown): ScopeSelection | undefined {
  if (!isRuntimeRecord(value) || value.schema !== 'review-scope/v1' || !Array.isArray(value.obligations)) return undefined;
  return scopeSelection({ ...value, obligations: value.obligations.map(/** Invalid fields survive as invalid selections rather than throwing. */ row => isRuntimeRecord(row) && Array.isArray(row.fields) ? { ...row, fields: row.fields.map(/** Digest values are verified by recapture, never trusted on input. */ (field: unknown) => isRuntimeRecord(field) ? field.name : undefined) } : row) });
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
  return new Map((item.acceptance_criteria ?? '').split(/[;\n]/).map(/** Core's criterion boundary convention ignores list padding. */ text => text.trim()).filter(Boolean).map(/** Order changes conservatively invalidate affected AC identifiers. */ (text, index) => [`AC${index + 1}`, scopeDigest(text)]));
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
