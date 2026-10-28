import { createPmCliExpectedError, encodeToon, isRuntimeRecord } from '@unbrained/pm-cli/sdk';
import { requestNumbers, requestRefusal } from './requests-validation.ts';
import type { EvidenceOutputFormat, EvidenceRequest, EvidenceRequestInput, EvidenceRequestQueue, EvidenceRequestResult } from './requests-types.ts';

/** Bound presentation memory to 240 code points without limiting persisted evidence eligibility. */
export function reviewTextExcerpt(text: string): { text: string; omitted: number } {
  const points: string[] = [];
  for (const point of text) {
    if (points.length === 240) break;
    points.push(point);
  }
  const excerpt = points.join('');
  return { text: excerpt, omitted: Buffer.byteLength(text) - Buffer.byteLength(excerpt) };
}

/** Immutable wire receipts are private to their result object, not a shared request budget or journal. */
const finalized = new WeakMap<EvidenceRequestResult, { format: EvidenceOutputFormat; output: string }>();

/** Use the SDK's standard TOON encoder and compact JSON before any budget decision. */
function encode(result: EvidenceRequestResult, format: EvidenceOutputFormat): string {
  return format === 'json' ? JSON.stringify(result) : encodeToon(result);
}

/** Return the measured wire bytes verbatim; changing encoding requires finalizing a new result. */
export function serializeEvidenceRequests(result: EvidenceRequestResult, format?: EvidenceOutputFormat): string {
  const receipt = finalized.get(result);
  if (receipt && (format === undefined || format === receipt.format)) return receipt.output;
  if (!receipt && !result.ok && !result.minimum) return encode(result, format ?? 'json');
  throw createPmCliExpectedError('This result is not finalized for the selected output encoding.', { context: { code: 'output_encoding_mismatch', nextSteps: ['Call reviewEvidenceRequests again with the desired JSON/TOON encoding, then serialize that unchanged result.'] } });
}

/** Freeze every returned collection so later callers and host hooks cannot invalidate measured output. */
function seal(value: object): void {
  for (const child of Object.values(value)) if (isRuntimeRecord(child) || Array.isArray(child)) seal(child);
  Object.freeze(value);
}

/** Derive row counts and stabilize the size field from the actual chosen wire encoding, including itself. */
function measure(queue: EvidenceRequestQueue, format: EvidenceOutputFormat): string {
  queue.pending = queue.requests.length + queue.omitted.length;
  queue.total = queue.pending + queue.satisfied.length + queue.skipped.length;
  let output = encode(queue, format);
  while (queue.characters !== Buffer.byteLength(output)) {
    queue.characters = Buffer.byteLength(output);
    output = encode(queue, format);
  }
  return output;
}

/** The only output-budget enforcement point: rebuild, serialize, measure, shrink, then return unchanged. */
export function finalizeReviewOutput(base: EvidenceRequestQueue, pending: EvidenceRequest[], budget: EvidenceRequestInput['budget'], format: EvidenceOutputFormat = 'json'): EvidenceRequestResult {
  const cap = Math.min(budget.requests, pending.length);
  let minimum = Number.MAX_SAFE_INTEGER;
  for (let count = cap; count >= 0; count--) {
    const queue: EvidenceRequestQueue = { ...base, requests: pending.slice(0, count), omitted: pending.slice(count).map(/** Omission reasons are finalized before measuring; count-limited rows retain their own reason. */ (row, offset) => ({ key: row.key, reason: count + offset < cap ? 'character_limit' : 'request_limit' })) };
    const output = measure(queue, format);
    const bytes = Buffer.byteLength(output);
    minimum = Math.min(minimum, bytes);
    if (bytes <= budget.characters) {
      if (!requestNumbers(queue)) return requestRefusal('output_invalid');
      seal(queue);
      finalized.set(queue, { format, output });
      return queue;
    }
  }
  const denied = { ...requestRefusal('budget_too_small'), minimum: { characters: minimum } };
  seal(denied);
  finalized.set(denied, { format, output: encode(denied, format) });
  return denied;
}
