import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { canonicalDocument, commitImportedItem, decodeToon, getHistoryPath, getItemPath, locateItem, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import { reviewConflicts, serializeConflictWitness } from '../index.ts';
import { fieldOptions } from '../src/tracker.ts';
import { conflictFixture, conflictPacket } from './conflict-fixture.ts';
import { richScopeDocument } from './scope-model-fixture.ts';
import { inFixtureWorkspace } from './helpers.ts';
import { findingLineage } from '../src/lineage.ts';
import type { LineageView } from '../src/lineage.ts';

/** Keep independent sequences in bounded history batches so verification does not grow quadratically. */
async function nativeModel(t: TestContext) {
  const { client, cwd, pmRoot, input: template, ids: sourceIds } = await conflictFixture(t);
  const ids = ['sample-native-conflict-a', 'sample-native-conflict-b'];
  const input = { ...template, item: ids[0] };
  const settings = await readSettings(pmRoot);
  const original = [];
  for (const [index, id] of ids.entries()) {
    const located = (await locateItem(pmRoot, sourceIds[index], undefined, undefined, { ReviewFinding: 'review-findings' }))!;
    const document = (await readLocatedItem(located)).document;
    const rich = richScopeDocument(document, sourceIds[1 - index]);
    rich.metadata.id = id;
    rich.metadata.review_verdict = 'pending';
    rich.metadata.review_reason = '';
    rich.metadata.review_node_id = `native-model-${index}`;
    // Avoid changing reviewed scope; every unrelated native family remains seeded and read back.
    await inFixtureWorkspace(cwd, () => commitImportedItem({ pmRoot, id, itemPath: getItemPath(pmRoot, 'ReviewFinding', id, undefined, { ReviewFinding: 'review-findings' }), document: canonicalDocument(rich), settings, author: 'model-agent', message: 'Seed native conflict model', conflictWarningPrefix: 'conflicts-model' }));
  }
  const proposal = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
  assert.equal((await findingLineage(client, ids[0], { with: ids[1], confirm: true, revision: proposal.revision, reason: 'Explicitly confirm identical native model scope' })).ok, true);
  for (const [index, id] of ids.entries()) {
    await client.update(id, fieldOptions({ review_verdict: index === 0 ? 'fix' : 'refuse', review_reason: 'Explicit native model reasoning', review_verdict_source: 'local' }));
    original.push((await client.get(id, { full: true })).item);
  }
  return { client, pmRoot, input, ids, original };
}

test('seeded model: 500 random native operation sequences and old-query replays preserve every SDK field and relationship', async t => {
  const seed = 0xc0f11028;
  let state = seed;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  let operations = 0; let oldReplays = 0; let conflicts = 0;
  let oversized = 0;
  let model = await nativeModel(t);
  const fields = Object.keys(model.original[0]);
  for (let sequence = 0; sequence < 500; sequence++) {
    if (sequence > 0 && sequence % 25 === 0) model = await nativeModel(t);
    const { client, pmRoot, input, ids, original } = model;
    const queries = [input, { ...input, revision: 'older-revision' }];
    for (let step = 0, length = 1 + next() % 3; step < length; step++) {
      const index = next() % 2; const id = ids[index]; const choice = next() % 7;
      if (choice === 0) await client.update(id, fieldOptions({ review_verdict: next() % 2 ? 'fix' : 'refuse', review_reason: `  Native reasoning ${next()}\r\nkeeps whitespace  `, review_verdict_source: 'local' }));
      else if (choice === 1) await client.update(id, fieldOptions({ review_withdrawn: next() % 2 === 0, review_head: next() % 2 ? input.revision : 'older-revision' }));
      else if (choice === 2) { await client.update(id, fieldOptions({ review_verdict: String(original[index].review_verdict), review_reason: String(original[index].review_reason), review_head: input.revision })); oldReplays++; }
      else if (choice === 3) await client.update(id, { description: `  native description ${next()}\r\nsecond line  `, body: `  body ${next()}\r\n ` });
      else if (choice === 4) await client.update(id, { dep: [`id=${ids[1 - index]},kind=related,author=model-agent,created_at=2026-10-01T10:00:00.000Z,source_kind=related_to`] });
      else if (choice === 5) await client.comments(id, { add: `foreign-provider/v1 ${next()}\r\n  annotation retained` });
      else await client.update(id, fieldOptions({ review_url: next() % 2 ? String(original[index].review_url) : '' }));
      operations++;
    }
    const query = queries[next() % queries.length];
    if (sequence % 100 === 0) {
      for (const [index, id] of ids.entries()) {
        await client.update(id, fieldOptions({ review_verdict: index === 0 ? 'fix' : 'refuse', review_reason: 'r'.repeat(100001), review_head: query.revision, review_url: String(original[index].review_url) }));
        operations++;
      }
      oversized++;
    }
    // JSON whitespace and CRLF are transport syntax, not a second normalization of native fields.
    const wire = JSON.stringify(query, null, next() % 2 ? 2 : 0).replaceAll('\n', next() % 2 ? '\r\n' : '\n');
    const current = await Promise.all(ids.map(id => client.get(id, { full: true }).then(row => row.item)));
    const graphs = await Promise.all(ids.map(id => client.deps(id, { format: 'graph' })));
    const histories = await Promise.all(ids.map(id => readFile(getHistoryPath(pmRoot, id), 'utf8')));
    // Independent model uses native SDK values; it never predicts SDK whitespace normalization.
    const inScope = current.filter(row => row.review_head === query.revision);
    const explicit = inScope.filter(row => ['fix', 'refuse'].includes(String(row.review_verdict)) && row.review_verdict_source !== 'import' && typeof row.review_reason === 'string' && row.review_reason.trim());
    const available = explicit.filter(row => row.review_url && row.review_node_id && row.review_bot);
    const opposed = available.some(row => row.review_verdict === 'fix') && available.some(row => row.review_verdict === 'refuse');
    const incomplete = available.length !== explicit.length || available.some(row => row.review_withdrawn === true);
    const result = conflictPacket(await reviewConflicts(client, JSON.parse(wire)));
    assert.equal(result.state, opposed ? 'conflict' : incomplete ? 'insufficient_evidence' : 'no_opposition_observed', `seed=${seed} sequence=${sequence}`);
    assert.deepEqual(result.judgments.map(row => row.item), available.map(row => row.id));
    assert.equal(result.resolution, 'unverified');
    if (opposed) conflicts++;
    for (const format of ['json', 'toon'] as const) {
      const encoded = serializeConflictWitness(result, format);
      assert.ok(Buffer.byteLength(encoded) <= 65536);
      assert.deepEqual(format === 'json' ? JSON.parse(encoded) : decodeToon(encoded), result);
    }
    for (const [index, id] of ids.entries()) {
      const after = (await client.get(id, { full: true })).item;
      for (const field of fields) assert.deepEqual(after[field], current[index][field], `Lost ${field} at sequence ${sequence}`);
      assert.deepEqual(await client.deps(id, { format: 'graph' }), graphs[index]);
      assert.equal(await readFile(getHistoryPath(pmRoot, id), 'utf8'), histories[index]);
    }
    if ((sequence + 1) % 100 === 0) t.diagnostic(`${sequence + 1}/500 conflict sequences checked`);
  }
  assert.ok(fields.length >= 75);
  assert.ok(oldReplays > 50);
  assert.ok(conflicts > 0);
  assert.equal(oversized, 5);
  t.diagnostic(`seed=${seed}; sequences=500; operations=${operations}; native fields=${fields.length}; older native value replays=${oldReplays}; conflicts=${conflicts}; oversized reason sequences=${oversized}; JSON/TOON and CRLF query replays preserve SDK state, relationships and audited histories`);
});
