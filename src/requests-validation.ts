import { isRuntimeRecord } from '@unbrained/pm-cli/sdk';
import type { EvidenceRequestCode, EvidenceRequestInput, EvidenceRequestRefusal } from './requests-types.ts';

/** One strict schema is applied once before any SDK reads; unknown keys are refused. */
export function requestInput(value: unknown): EvidenceRequestInput | undefined {
  if (!keys(value, ['schema', 'select', 'arrivals', 'budget']) || value.schema !== 'review-requests/v1' || !dense(value.select, 64) || !dense(value.arrivals, 64) || !keys(value.budget, ['requests', 'characters']) || !integer(value.budget.requests, 0, 64) || !integer(value.budget.characters, 256, 65536)) return undefined;
  const selections = new Set<string>();
  for (const row of value.select) {
    if (!keys(row, ['item', 'obligation', 'missing']) || !identifier(row.item) || typeof row.obligation !== 'string' || !/^(?:finding|AC[1-9]\d{0,5})$/.test(row.obligation) || (row.missing !== 'source' && row.missing !== 'test')) return undefined;
    const key = JSON.stringify([row.item, row.obligation, row.missing]);
    if (selections.has(key)) return undefined;
    selections.add(key);
  }
  const arrivals = new Set<string>();
  for (const row of value.arrivals) {
    if (!keys(row, ['request', 'item', 'version', 'field', 'index']) || typeof row.request !== 'string' || !/^[a-f0-9]{64}$/.test(row.request) || arrivals.has(row.request) || !identifier(row.item) || !integer(row.version, 1, Number.MAX_SAFE_INTEGER) || (row.field !== 'files' && row.field !== 'tests') || !integer(row.index, 0, 4095)) return undefined;
    arrivals.add(row.request);
  }
  return structuredClone(value) as unknown as EvidenceRequestInput;
}

/** Strict objects cannot silently reinterpret another package's records. */
function keys(value: unknown, names: string[]): value is Record<string, unknown> {
  return isRuntimeRecord(value) && Object.keys(value).length === names.length && names.every(/** Required fields must be own properties. */ name => Object.hasOwn(value, name));
}

/** Dense bounded arrays reject holes before iterators or JSON can erase them. */
function dense(value: unknown, limit: number): value is unknown[] {
  return Array.isArray(value) && value.length <= limit && Object.keys(value).length === value.length && Array.from({ length: value.length }, /** Every numeric position must exist. */ (_, index) => Object.hasOwn(value, index)).every(Boolean);
}

/** Finite safe integers are the only numeric input domain. */
function integer(value: unknown, min: number, max: number): boolean { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }

/** Keep selectors portable, bounded and free of whitespace or filesystem syntax. */
function identifier(value: unknown): boolean { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(value); }

/** Check every emitted number, including numbers originating in native SDK records. */
export function requestNumbers(value: unknown): boolean {
  if (typeof value === 'number') return integer(value, 0, Number.MAX_SAFE_INTEGER);
  if (Array.isArray(value)) return value.every(requestNumbers);
  return !isRuntimeRecord(value) || Object.values(value).every(requestNumbers);
}

/** Refusals deliberately omit backend exceptions and local source paths. */
export function requestRefusal(code: EvidenceRequestCode): EvidenceRequestRefusal {
  const remedies: Record<EvidenceRequestCode, string> = {
    input_invalid: 'Use review-requests/v1 with at most 64 unique selections and arrivals, dense arrays, exact documented keys, safe integer revisions, and budgets of 0-64 requests and 256-65536 JSON characters.',
    file_unavailable: 'Supply one regular UTF-8 JSON packet file of at most 1 MiB.',
    state_changed: 'A selected item, evidence revision or status registry changed during observation; read current state and retry.',
    budget_too_small: 'Increase the character budget to fit the exact omission, satisfaction and skip receipts, or select fewer obligations.',
    output_invalid: 'Correct invalid numeric metadata in the selected tracker artifacts and retry.',
  };
  return { ok: false, refusal: { code, remedy: remedies[code] } };
}
