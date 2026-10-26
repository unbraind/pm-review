import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { canonicalDocument, commitImportedItem, getHistoryPath, getItemPath, locateItem, readHistoryEntries, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import { reviewEvidenceRequests, reviewEvidenceRequestsFile } from '../src/requests.ts';
import type { EvidenceRequestInput } from '../src/requests-types.ts';
import { requestsFixture, queue } from './requests-fixture.ts';
import { richScopeDocument } from './scope-model-fixture.ts';
import { inFixtureWorkspace } from './helpers.ts';

test('seeded model: 500 random packet/arrival sequences preserve every native field, relationships, whitespace and old-input replays through SDK reads', async t => {
  const seed = 0x10e71026;
  let state = seed;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const { client, cwd, pmRoot, finding, evidence: template, packet } = await requestsFixture(t);
  const settings = await readSettings(pmRoot);
  const source = (await locateItem(pmRoot, template))!;
  const evidence = 'sample-native-evidence';
  const original = richScopeDocument((await readLocatedItem(source)).document, finding);
  original.metadata.files![0].path = 'src/input.ts';
  original.metadata.id = evidence;
  await inFixtureWorkspace(cwd, async () => commitImportedItem({ pmRoot, id: evidence, itemPath: getItemPath(pmRoot, 'Task', evidence), document: canonicalDocument(original), settings, author: 'model-agent', message: 'Seed all native evidence fields', conflictWarningPrefix: 'requests-model' }));
  const fields = Object.keys((await client.get(evidence, { full: true })).item);
  const packets: { input: EvidenceRequestInput; targetVersion: number }[] = [];
  const file = join(cwd, 'requests.json');
  const version = async (id: string) => (await readHistoryEntries(getHistoryPath(pmRoot, id), id)).length;
  let operations = 0; let comparisons = 0; let satisfied = 0; let replays = 0;
  for (let sequence = 0; sequence < 500; sequence++) {
    const initial = queue(await reviewEvidenceRequests(client, { ...packet, select: [packet.select[0]] }));
    const binding: EvidenceRequestInput = { ...packet, select: [packet.select[0]], arrivals: [{ request: initial.requests[0].key, item: evidence, version: await version(evidence), field: 'files', index: 0 }] };
    packets.push({ input: binding, targetVersion: await version(finding) });
    const length = 3 + next() % 3;
    for (let step = 0; step < length; step++) {
      const choice = sequence % 10 === 0 ? 5 : next() % 6;
      if (choice === 0) await client.update(finding, { description: `  target ${next()}\r\nsecond line  ` });
      else if (choice === 1) await client.update(evidence, { description: `  source ${next()}\r\nsecond line  `, body: `  body ${next()}\n ` });
      else if (choice === 2) {
        await client.update(evidence, { description: original.metadata.description, body: original.body });
        replays++;
      } else if (choice === 3) await client.update(evidence, { dep: [`id=${finding},kind=related,author=model-agent,created_at=2026-10-01T10:00:00.000Z,source_kind=related_to`], tags: `model-${next() % 9}` });
      else if (choice === 4) await client.comments(evidence, { add: `foreign-provider/v1 ${next()}\r\n  Native annotation` });
      // Choice five replays an older packet with no native mutation at all.
      operations++;
    }
    const model = packets[sequence % 10 === 0 ? packets.length - 1 : next() % packets.length];
    const currentTarget = (await client.get(finding, { full: true })).item;
    const currentEvidence = (await client.get(evidence, { full: true })).item;
    const targetVersion = await version(finding); const sourceVersion = await version(evidence);
    const graph = await client.deps(evidence, { format: 'graph' });
    const history = await readFile(getHistoryPath(pmRoot, evidence), 'utf8');
    const text = JSON.stringify(model.input, null, next() % 2 ? 2 : 0).replaceAll('\n', next() % 2 ? '\r\n' : '\n');
    await writeFile(file, text);
    const result = queue(await reviewEvidenceRequestsFile(client, file));
    // The reference model uses durable versions and SDK-native field values, never hand-written normalization.
    const expected = model.targetVersion === targetVersion && model.input.arrivals[0].version === sourceVersion && Boolean(currentEvidence.description?.trim()) && currentEvidence.files?.[0]?.path === currentTarget.review_path;
    assert.equal(result.satisfied.length, expected ? 1 : 0, `seed=${seed} sequence=${sequence} result=${JSON.stringify(result)}`);
    assert.equal(result.pending, expected ? 0 : 1, `seed=${seed} sequence=${sequence}`);
    if (expected) satisfied++;
    const afterEvidence = (await client.get(evidence, { full: true })).item;
    for (const field of fields) assert.ok(isDeepStrictEqual(afterEvidence[field], currentEvidence[field]), `Native ${field} lost in sequence ${sequence}`);
    assert.deepEqual((await client.get(finding, { full: true })).item, currentTarget);
    assert.deepEqual(await client.deps(evidence, { format: 'graph' }), graph);
    assert.equal(await readFile(getHistoryPath(pmRoot, evidence), 'utf8'), history);
    if (sequence % 50 === 0) assert.deepEqual(await reviewEvidenceRequests(client, JSON.parse(text)), result);
    comparisons++;
    if ((sequence + 1) % 100 === 0) t.diagnostic(`${sequence + 1}/500 request sequences checked`);
  }
  assert.ok(fields.length >= 75, `Only ${fields.length} native fields seeded`);
  assert.ok(replays > 100);
  assert.ok(satisfied > 0);
  t.diagnostic(`seed=${seed}; sequences=500; operations=${operations}; comparisons=${comparisons}; native fields=${fields.length}; older source value replays=${replays}; satisfied=${satisfied}; old packet/arrival replays, SDK/file parity and read-back state preserved`);
});
