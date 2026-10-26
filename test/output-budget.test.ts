import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeToon } from '@unbrained/pm-cli/sdk';
import { finalizeReviewOutput, serializeEvidenceRequests } from '../src/output-budget.ts';
import type { EvidenceOutputFormat, EvidenceRequest, EvidenceRequestQueue } from '../src/requests-types.ts';

/** Construct the full minimal protocol envelope, with intentionally stale counts for recount properties. */
export function budgetQueue(): EvidenceRequestQueue {
  return { ok: true, schema: 'review-requests/v1', approval: 'unverified', consistency: 'observed', total: 999, pending: 999, characters: 0, requests: [], omitted: [], satisfied: [], skipped: [], rejected: [] };
}

/** An independent wire oracle uses standard JSON and the SDK encoder, never the production finalizer. */
export function wire(value: unknown, format: EvidenceOutputFormat): string { return format === 'json' ? JSON.stringify(value) : encodeToon(value); }

/** Enumerate the protocol's legal prefix envelopes so refusal minima can be checked independently. */
function referenceSize(base: EvidenceRequestQueue, rows: EvidenceRequest[], cap: number, count: number, format: EvidenceOutputFormat): number {
  const value = structuredClone(base);
  value.requests = []; value.omitted = [];
  rows.forEach((row, index) => {
    if (index < count) value.requests.push(row);
    else value.omitted.push({ key: row.key, reason: index >= cap ? 'request_limit' : 'character_limit' });
  });
  value.pending = rows.length;
  value.total = rows.length + value.satisfied.length + value.skipped.length;
  for (;;) {
    const encoded = Buffer.from(wire(value, format));
    if (encoded.byteLength === value.characters) return encoded.byteLength;
    value.characters = encoded.byteLength;
  }
}

/** Generate valid artifact requests with escaped, multiline and multibyte source values. */
export function budgetRequest(index: number, text: string): EvidenceRequest {
  return { item: `sample-${index}`, obligation: index % 2 ? 'AC1' : 'finding', missing: index % 2 ? 'test' : 'source', key: index.toString(16).padStart(64, 'a'), version: index + 1, text, text_omitted: Buffer.byteLength(text), path: 'src/é.ts', line: index, ask: `Provide one artifact: ${text}` };
}

test('final budget regression: reason expansion cannot turn the 297-byte omission envelope into 299-byte success', () => {
  const result = finalizeReviewOutput(budgetQueue(), [budgetRequest(1, 'finding')], { requests: 1, characters: 297 });
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Oversized successful result');
  assert.equal(result.refusal.code, 'budget_too_small');
  assert.deepEqual(result.minimum, { characters: 299 });
  assert.throws(() => serializeEvidenceRequests(structuredClone(result)), /not finalized/);
  const exact = finalizeReviewOutput(budgetQueue(), [budgetRequest(1, 'finding')], { requests: 1, characters: 299 });
  assert.equal(exact.ok, true);
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 299);
  assert.equal(serializeEvidenceRequests(exact), JSON.stringify(exact));
  assert.throws(() => serializeEvidenceRequests(exact, 'toon'), /not finalized/);
  assert.throws(() => serializeEvidenceRequests(structuredClone(exact)), /not finalized/);
  assert.equal(serializeEvidenceRequests({ ok: false, refusal: { code: 'input_invalid', remedy: 'Correct the packet.' } }), '{"ok":false,"refusal":{"code":"input_invalid","remedy":"Correct the packet."}}');
});

test('500 seeded output properties cover every JSON/TOON prefix boundary, reason class, UTF-8 width and minimum', t => {
  let state = 0x0b0d1026;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  let checked = 0;
  for (let trial = 0; trial < 500; trial++) {
    const base = budgetQueue();
    if (next() % 3 === 0) base.satisfied.push({ key: 'f'.repeat(64), item: `artifact-${trial}`, version: trial + 1 });
    if (next() % 3 === 0) base.skipped.push({ selection: 0, reason: 'criterion_reviewed' });
    if (next() % 3 === 0) base.rejected.push({ arrival: 0, reason: 'request_not_current' });
    base.omitted.push({ key: 'stale', reason: next() % 2 ? 'character_limit' : 'request_limit' });
    const rows = Array.from({ length: next() % 7 }, (_, index) => budgetRequest(index, ['a', 'é🧪', '"\\\n\r\t', '漢字'][next() % 4].repeat(next() % 40)));
    const ceiling = next() % (rows.length + 1);
    for (const format of ['json', 'toon'] as const) {
      const sizes = Array.from({ length: ceiling + 1 }, (_, count) => referenceSize(base, rows, ceiling, count, format));
      const minimum = Math.min(...sizes);
      const budgets = new Set([0, 297, Number.MAX_SAFE_INTEGER, ...sizes.flatMap(size => [size - 1, size, size + 1])]);
      for (const characters of budgets) {
        const result = finalizeReviewOutput(base, rows, { requests: ceiling, characters }, format);
        if (result.ok) {
          const bytes = Buffer.byteLength(wire(result, format));
          assert.ok(bytes <= characters, `trial=${trial} format=${format} budget=${characters} actual=${bytes}`);
          assert.equal(result.characters, bytes);
          assert.equal(serializeEvidenceRequests(result, format), wire(result, format));
          assert.equal(serializeEvidenceRequests(result), wire(result, format));
          assert.ok(result.requests.length <= ceiling);
          assert.equal(result.pending, result.requests.length + result.omitted.length);
          assert.equal(result.total, result.pending + result.satisfied.length + result.skipped.length);
          assert.equal(result.pending, rows.length);
          assert.ok(Object.isFrozen(result) && Object.isFrozen(result.requests));
          assert.throws(() => { result.characters++; }, TypeError);
        } else {
          assert.equal(result.refusal.code, 'budget_too_small');
          assert.deepEqual(result.minimum, { characters: minimum });
          assert.ok(characters < minimum);
        }
        checked++;
      }
    }
  }
  t.diagnostic(`seed=0x0b0d1026; 500 random output models; ${checked} JSON/TOON boundary budgets checked against actual UTF-8 wire bytes`);
});
