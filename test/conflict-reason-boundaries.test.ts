import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createExtensionCommandSdk, decodeToon, getHistoryPath } from '@unbrained/pm-cli/sdk';
import type { SuppressedHostOutput } from '@unbrained/pm-cli/sdk';
import { reviewConflicts, serializeConflictWitness } from '../index.ts';
import { runReviewCommand } from '../src/commands.ts';
import { reviewTextExcerpt, serializeEvidenceRequests } from '../src/output-budget.ts';
import { reviewEvidenceRequests } from '../src/requests.ts';
import { fieldOptions, recordVerdict } from '../src/tracker.ts';
import type { ConflictResult } from '../src/conflict-types.ts';
import { conflictFixture, conflictPacket } from './conflict-fixture.ts';

test('seeded excerpt property: 500 size and Unicode variants preserve presentation without a semantic length cutoff', () => {
  let seed = 0x10290061;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const glyphs = ['x', '😀', '界', '\r', '\n', '\u0301'];
  const tails = [0, 1, 239, 240, 241, 99999, 100000, 100001, 200001];
  for (let sample = 0; sample < 500; sample++) {
    const prefix = Array.from({ length: next() % 242 }, () => glyphs[next() % glyphs.length]);
    const glyph = glyphs[next() % glyphs.length];
    const tail = tails[sample % tails.length] + next() % 3;
    const native = prefix.join('') + glyph.repeat(tail);
    const expected = prefix.slice(0, 240).join('') + glyph.repeat(Math.min(tail, Math.max(0, 240 - prefix.length)));
    assert.deepEqual(reviewTextExcerpt(native), { text: expected, omitted: Buffer.byteLength(native) - Buffer.byteLength(expected) }, `sample=${sample}`);
  }
  assert.deepEqual(reviewTextExcerpt(''), { text: '', omitted: 0 });
  assert.deepEqual(reviewTextExcerpt('\ud800'.repeat(241)), { text: '\ud800'.repeat(240), omitted: 3 });
});

test('persisted reason size never erases an explicit opposed judgment in SDK or CLI JSON/TOON on a non-git tracker', async t => {
  const { client, input, ids, pmRoot, cwd } = await conflictFixture(t);
  const lengths = [239, 240, 241, 99999, 100000, 100001, 200001];
  for (const [index, length] of lengths.entries()) {
    const id = ids[index % 2];
    const row = (await client.listAllComplete()).items.find(item => item.id === id)!;
    await recordVerdict(client, row, index % 2 === 0 ? 'fix' : 'refuse', 'r'.repeat(length), '');
    const before = (await client.get(id, { full: true })).item;
    const history = await readFile(getHistoryPath(pmRoot, id), 'utf8');
    const native = String(before.review_reason);
    const result = conflictPacket(await reviewConflicts(client, input));
    assert.equal(result.state, 'conflict', `reason length=${native.length}`);
    assert.deepEqual(result.judgments.map(judgment => judgment.item), ids);
    const judgment = result.judgments.find(judgment => judgment.item === id)!;
    assert.equal(judgment.reason, native.slice(0, 240));
    assert.equal(judgment.reason_omitted, Buffer.byteLength(native) - Buffer.byteLength(judgment.reason));
    for (const format of ['json', 'toon'] as const) {
      const wire = serializeConflictWitness(result, format);
      assert.ok(Buffer.byteLength(wire) <= 65536);
      assert.deepEqual(format === 'json' ? JSON.parse(wire) : decodeToon(wire), result);
    }
    assert.deepEqual((await client.get(id, { full: true })).item, before);
    assert.equal(await readFile(getHistoryPath(pmRoot, id), 'utf8'), history);
  }
  const sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
  for (const json of [false, true]) {
    let wire = '';
    const capture = t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => { wire += String(chunk); return true; });
    try {
      const receipt = await runReviewCommand({ command: 'review conflicts', args: [ids[0]], options: { revision: input.revision }, global: { json }, repo_root: cwd, pm_root: pmRoot, sdk }) as SuppressedHostOutput<ConflictResult>;
      assert.equal(conflictPacket(receipt.result!).state, 'conflict');
      assert.deepEqual(json ? JSON.parse(wire) : decodeToon(wire), receipt.result);
    } finally { capture.mock.restore(); }
  }
});

test('conflict and evidence-request producers retain long Unicode evidence with bounded, byte-exact excerpts in both encodings', async t => {
  const { client, input, ids } = await conflictFixture(t);
  const text = '😀\r\n'.repeat(25001);
  await client.update(ids[1], fieldOptions({ review_reason: text, review_summary: text }));
  const native = (await client.get(ids[1], { full: true })).item;
  const expected = String(native.review_reason).slice(0, 320);
  const witness = conflictPacket(await reviewConflicts(client, input));
  assert.equal(witness.state, 'conflict');
  const judgment = witness.judgments.find(row => row.item === ids[1])!;
  assert.equal(judgment.reason, expected);
  assert.equal(judgment.reason_omitted, Buffer.byteLength(String(native.review_reason)) - Buffer.byteLength(expected));
  for (const format of ['json', 'toon'] as const) {
    const queue = await reviewEvidenceRequests(client, { schema: 'review-requests/v1', select: [{ item: ids[1], obligation: 'finding', missing: 'test' }], arrivals: [], budget: { requests: 1, characters: 65536 } }, format);
    if (!queue.ok) assert.fail(JSON.stringify(queue));
    assert.equal(queue.pending, 1);
    assert.equal(queue.skipped.length, 0);
    assert.equal(queue.requests[0].text, expected);
    assert.equal(queue.requests[0].text_omitted, Buffer.byteLength(String(native.review_summary)) - Buffer.byteLength(expected));
    const wire = serializeEvidenceRequests(queue, format);
    assert.ok(Buffer.byteLength(wire) <= 65536);
    assert.deepEqual(format === 'json' ? JSON.parse(wire) : decodeToon(wire), queue);
  }
});
