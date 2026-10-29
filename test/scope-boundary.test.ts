import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { captureReviewScope, carryForwardReview, checkedScopeResult } from '../src/scope.ts';
import { parseScopeInput } from '../src/scope-validation.ts';
import type { ReviewScope } from '../src/scope-types.ts';
import { scopeDenied, scopeFixture } from './scope-fixture.ts';

/** Inject scheduling/observation around a real SDK, never substitute tracker state. */
function counted(client: PmClient) {
  let reads = 0;
  const observed = new Proxy(client, { get(target, key, receiver) {
    if (key !== 'get') return Reflect.get(target, key, receiver);
    return (...args: Parameters<PmClient['get']>) => { reads++; return target.get(...args); };
  } });
  return { observed, reads: () => reads };
}

test('strict scope schema refuses sparse, extreme and extra input before any SDK read; previous producer receipts remain portable', async t => {
  const { client, id, selection } = await scopeFixture(t);
  const { observed, reads } = counted(client);
  const baseline = await captureReviewScope(client, id, selection) as ReviewScope;
  assert.equal(baseline.ok, true);
  const legacy: unknown = JSON.parse(await readFile(new URL('./fixtures/review-scope-v1.json', import.meta.url), 'utf8'));
  assert.ok(parseScopeInput(legacy, true), 'Receipt emitted by the released producer must remain readable');
  const row = selection.obligations[0];
  const captured = baseline.obligations[0];
  const bad: unknown[] = [
    { ...selection, extra: 'foreign' },
    { version: selection.version, author: selection.author, obligations: selection.obligations, extra: selection.reason },
    { ...selection, obligations: Array(1) },
    { ...selection, obligations: Object.assign([...selection.obligations], { extra: true }) },
    ...[Array(1), ['description', ...Array(1)]].map(fields => ({ ...selection, obligations: [{ ...row, fields }] })),
    ...[Array(1), [{ id, version: 1 }, ...Array(1)]].map(evidence => ({ ...selection, obligations: [{ ...row, evidence }] })),
    { ...selection, obligations: [{ ...row, extra: true }] },
    ...['', 'AC1x', 'AC' + '1'.repeat(15)].map(criterion => ({ ...selection, obligations: [{ ...row, criterion }] })),
    { ...selection, obligations: [{ ...row, fields: ['a'.repeat(201)] }] },
    ...[' ', 'a'.repeat(1001)].map(id => ({ ...selection, obligations: [{ ...row, evidence: [{ id, version: 1 }] }] })),
    { ...selection, obligations: [{ ...row, evidence: [{ id, version: 1, extra: true }] }] },
  ];
  bad.push({ ...selection, obligations: Array.from({ length: 32 }, (_, index) => ({ ...row, criterion: `AC${index + 1}`, evidence: Array.from({ length: 16 }, (_, source) => ({ id: `${source}` + '\0'.repeat(995), version: 1 })) })) });
  const badReceipts: unknown[] = [
    { ...baseline, extra: true }, { ...baseline, ok: false }, { ...baseline, id: '' },
    { ...baseline, obligations: Array(1) },
    { ...baseline, obligations: [{ ...captured, fields: Array(1) }] },
    { ...baseline, obligations: [{ ...captured, evidence: Array(1) }] },
    { ...baseline, obligations: [{ ...captured, digest: 'x'.repeat(64) }] },
    { ...baseline, obligations: [{ ...captured, fields: [captured.fields[0], captured.fields[0]] }] },
    { ...baseline, obligations: [{ ...captured, evidence: [{ ...captured.evidence[0], extra: true }] }] },
  ];
  for (const version of [-Infinity, Infinity, NaN, -1, 0, 0.5, Number.MIN_VALUE, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, 1n, '1', null]) {
    bad.push({ ...selection, version }, { ...selection, obligations: [{ ...row, evidence: [{ id, version }] }] });
    badReceipts.push({ ...baseline, version }, { ...baseline, obligations: [{ ...captured, evidence: [{ ...captured.evidence[0], version }] }] });
  }
  for (const input of bad) scopeDenied(await captureReviewScope(observed, id, input), 'scope_invalid');
  for (const input of badReceipts) scopeDenied(await carryForwardReview(observed, id, input), 'scope_invalid');
  assert.equal(reads(), 0);
  // Shape and serialization match the released v1 producer: no new keys or normalization.
  assert.deepEqual(Object.keys(baseline).sort(), ['artifact', 'author', 'id', 'obligations', 'ok', 'reason', 'schema', 'version']);
  for (const input of [baseline, JSON.parse(JSON.stringify(baseline, null, 2).replaceAll('\n', '\r\n'))]) {
    assert.deepEqual(parseScopeInput(input, true), baseline);
    const result = await carryForwardReview(client, id, input);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.approval, 'unverified');
  }
});

test('seeded boundary fuzz covers numeric domains and every producer output validates and preserves native readback', async t => {
  const { client, id, evidence, selection } = await scopeFixture(t);
  let seed = 0x2883cafe;
  const before = (await client.get(id, { full: true })).item;
  const beforeEvidence = (await client.get(evidence, { full: true })).item;
  for (let trial = 0; trial < 600; trial++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const version = trial % 2 ? Number(`1e${seed % 650 - 325}`) : seed / 3;
    const input = { ...selection, version };
    if (!Number.isSafeInteger(version) || version <= 0 || version >= Number.MAX_SAFE_INTEGER) scopeDenied(await captureReviewScope(client, id, input), 'scope_invalid');
    else if (version === 1) assert.equal((await captureReviewScope(client, id, input)).ok, true);
    else scopeDenied(await captureReviewScope(client, id, input), 'history_unavailable');
    if (trial % 20 !== 0) continue;
    await client.focus((seed >>> 4) % 2 ? id : evidence);
    const scope = await captureReviewScope(client, id, { ...selection, author: 'review-agent', reason: `${' '.repeat(trial % 7)}Explicit scope review ${trial}\r\n ` });
    assert.ok(parseScopeInput(scope, true));
    const report = await carryForwardReview(client, id, JSON.parse(JSON.stringify(scope)));
    assert.equal(report.ok, true);
    if (report.ok) {
      for (const count of Object.values(report.counts)) assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 3);
      assert.equal(report.from, 1);
      assert.equal(report.approval, 'unverified');
    }
  }
  assert.deepEqual((await client.get(id, { full: true })).item, before);
  assert.deepEqual((await client.get(evidence, { full: true })).item, beforeEvidence);
});


test('output boundary refuses non-finite, negative and unsafe numbers using the input version domain', async t => {
  const { client, id, selection } = await scopeFixture(t);
  const scope = await captureReviewScope(client, id, selection);
  assert.equal(scope.ok, true);
  if (!scope.ok) assert.fail('Expected a produced receipt');
  const report = await carryForwardReview(client, id, scope);
  assert.equal(report.ok, true);
  if (!report.ok) assert.fail('Expected a produced report');
  for (const value of [-Infinity, Infinity, NaN, -1, 0.5, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1]) {
    scopeDenied(checkedScopeResult({ ...scope, version: value }), 'scope_invalid');
    scopeDenied(checkedScopeResult({ ...scope, obligations: [{ ...scope.obligations[0], evidence: [{ ...scope.obligations[0].evidence[0], version: value }] }] }), 'scope_invalid');
    scopeDenied(checkedScopeResult({ ...report, from: value }), 'scope_invalid');
    for (const key of Object.keys(report.counts)) scopeDenied(checkedScopeResult({ ...report, counts: { ...report.counts, [key]: value } }), 'scope_invalid');
  }
  assert.deepEqual(checkedScopeResult(scope), scope);
  assert.deepEqual(checkedScopeResult(report), report);
});
