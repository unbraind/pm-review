import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalDocument, commitImportedItem, getHistoryPath, getItemPath, locateItem, readHistoryEntries, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import type { GetResult, ItemDocument } from '@unbrained/pm-cli/sdk';
import { captureReviewScope } from '../src/scope.ts';
import { reviewScopeFile } from '../src/scope-file.ts';
import type { CarryForwardReport, ReviewScope } from '../src/scope-types.ts';
import { scopeFixture } from './scope-fixture.ts';
import { richScopeDocument } from './scope-model-fixture.ts';
import { inFixtureWorkspace } from './helpers.ts';

/** Deterministic generator; replay failures by seed and sequence number. */
function random(seed: number): () => number {
  let state = seed;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}

/** Reference state stores SDK-native values and explicit revision identity, with no private normalization rules. */
interface Reference {
  receipt: ReviewScope; artifact: GetResult['item']; evidence: GetResult['item']; evidenceVersion: number;
}

/** Independent value-equality model: field values and evidence version must match the reviewed observations. */
function referenceCounts(model: Reference, current: GetResult['item'], evidence: GetResult['item'], evidenceVersion: number): CarryForwardReport['counts'] {
  const counts = { unchanged: 0, stale: 0, never_reviewed: 0, removed: 0 };
  for (const row of model.receipt.obligations) {
    if (row.judgment === 'gap') counts.never_reviewed++;
    else if (row.fields.some(field => !isDeepStrictEqual(model.artifact[field.name], current[field.name])) || row.evidence.length > 0 && (model.evidenceVersion !== evidenceVersion || !isDeepStrictEqual(model.evidence, evidence))) counts.stale++;
    else counts.unchanged++;
  }
  return counts;
}

test('seeded model: 500 random operation sequences preserve all native SDK state across scope export, file input and old receipt replays', async t => {
  const seed = 0x51c0f025;
  const next = random(seed);
  const nativeFields = new Set<string>();
  let comparisons = 0;
  let operations = 0;
  for (let sequence = 0; sequence < 500; sequence++) {
    const { client, id: templateId, evidence, cwd, pmRoot, selection } = await scopeFixture(t);
    const id = "sample-native-model";
    const settings = await readSettings(pmRoot);
    const located = (await locateItem(pmRoot, templateId))!;
    const sourceLocated = (await locateItem(pmRoot, evidence))!;
    const sourceDocument = (await readLocatedItem(sourceLocated)).document;
    const seedDocument = richScopeDocument((await readLocatedItem(located)).document, evidence);
    seedDocument.metadata.id = id;
    // Core owns normalization and audited imports. The package never serializes native item data.
    await inFixtureWorkspace(cwd, async () => commitImportedItem({ pmRoot, id, itemPath: getItemPath(pmRoot, "Task", id), document: canonicalDocument(seedDocument), settings, author: 'model-agent', message: 'Seed native scope model', conflictWarningPrefix: 'scope-model' }));
    const artifact = (await client.get(id, { full: true })).item;
    const fields = Object.keys(artifact);
    fields.forEach(field => nativeFields.add(field));
    const groups = Array.from({ length: Math.ceil(fields.length / 16) }, (_, index) => fields.slice(index * 16, index * 16 + 16));
    await client.update(id, { acceptanceCriteria: groups.map((_, i) => `Native criterion ${i + 1}`).join('; ') });
    const version = async (item: string) => (await readHistoryEntries(getHistoryPath(pmRoot, item), item)).length;
    const file = join(cwd, 'scope.json');
    const references: Reference[] = [];
    /** Capture one model observation and prove declaration JSON transport uses the same verified version. */
    async function capture(): Promise<void> {
      const input = { ...selection, version: await version(id), obligations: groups.map((group, index) => ({ criterion: `AC${index + 1}`, fields: group, evidence: index === 0 ? [{ id: evidence, version: 1 }] : [], judgment: index === groups.length - 1 && sequence % 3 === 0 ? 'gap' : 'reviewed' })) };
      await client.get(id, { full: true, at: String(input.version) });
      const receipt = await captureReviewScope(client, id, input) as ReviewScope;
      assert.equal(receipt.ok, true, `seed=${seed} sequence=${sequence} receipt=${JSON.stringify(receipt)}`);
      const sdkState = (await client.get(id, { full: true })).item;
      // Recapture evidence at its explicitly selected historical version, not current values.
      references.push({ receipt, artifact: sdkState, evidence: (await client.get(evidence, { full: true, at: '1' })).item, evidenceVersion: 1 });
      await writeFile(file, JSON.stringify(input, null, sequence % 2 === 0 ? 2 : 0).replaceAll('\n', sequence % 2 === 0 ? '\r\n' : '\n'));
      assert.deepEqual(await reviewScopeFile(client, id, file, true), receipt);
      operations++;
    }
    await capture();
    const length = 3 + next() % 3;
    for (let operation = 0; operation < length; operation++) {
      const choice = next() % 5;
      if (choice === 0) await client.update(id, { description: `  value ${next()}\r\nsecond line  `, body: `  body ${next()}\nlast line  ` });
      else if (choice === 1) await client.update(id, { dep: [`id=${evidence},kind=${next() % 2 ? 'blocks' : 'related'},author=model-agent,created_at=2026-10-01T10:00:00.000Z,source_kind=related_to`] });
      else if (choice === 2) await client.update(evidence, { description: `  evidence ${next()}\r\nsecond line  ` });
      else if (choice === 3) {
        // Replay genuinely older native input, including its old timestamp, through the core import path.
        const document: ItemDocument = structuredClone(sourceDocument);
        await inFixtureWorkspace(cwd, async () => commitImportedItem({ pmRoot, id: evidence, itemPath: sourceLocated.itemPath, document, settings, author: 'model-agent', message: 'Replay old native evidence input', conflictWarningPrefix: 'scope-model' }));
      } else await client.comments(id, { add: `foreign-provider/v1 annotation ${next()}\r\n  preserves native values` });
      operations++;
      if (operation === 1) await capture();
      const model = references[next() % references.length];
      const current = (await client.get(id, { full: true })).item;
      const currentEvidence = (await client.get(evidence, { full: true })).item;
      const evidenceVersion = await version(evidence);
      const graph = await client.deps(id, { format: 'graph' });
      const history = await readFile(getHistoryPath(pmRoot, id), 'utf8');
      await writeFile(file, JSON.stringify(model.receipt, null, next() % 2 ? 2 : 0).replaceAll('\n', next() % 2 ? '\r\n' : '\n'));
      const result = await reviewScopeFile(client, id, file, false) as CarryForwardReport;
      assert.equal(result.ok, true, `seed=${seed} sequence=${sequence} operation=${operation}`);
      assert.deepEqual(result.counts, referenceCounts(model, current, currentEvidence, evidenceVersion), `seed=${seed} sequence=${sequence} operation=${operation}`);
      assert.equal(result.approval, 'unverified');
      assert.deepEqual((await client.get(id, { full: true })).item, current, 'Old scope replay changed native artifact state');
      assert.deepEqual((await client.get(evidence, { full: true })).item, currentEvidence, 'Old scope replay changed native evidence state');
      assert.deepEqual(await client.deps(id, { format: 'graph' }), graph, 'Scope replay lost a relationship or its attributes');
      assert.equal(await readFile(getHistoryPath(pmRoot, id), 'utf8'), history, 'Scope replay wrote native history');
      comparisons++;
    }
    if ((sequence + 1) % 100 === 0) t.diagnostic(`${sequence + 1}/500 seeded sequences checked`);
  }
  assert.ok(nativeFields.size >= 75, `Native field families were not fully seeded: ${nativeFields.size}`);
  t.diagnostic(`seed=${seed}; sequences=500; operations=${operations}; comparisons=${comparisons}; native SDK fields=${nativeFields.size}; replayed receipt versions never wrote native state`);
});
