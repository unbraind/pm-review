import '../src/requests-types.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk, getHistoryPath } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension, { reviewEvidenceRequests, reviewEvidenceRequestsFile } from '../index.ts';
import { requestSnapshot, arrivalReason } from '../src/requests-state.ts';
import { requestInput, requestNumbers } from '../src/requests-validation.ts';
import { coverCriterion } from '../src/coverage.ts';
import { runReviewCommand } from '../src/commands.ts';
import { fieldOptions } from '../src/tracker.ts';
import { inFixtureWorkspace } from './helpers.ts';
import { requestsFixture, queue, requestsDenied, reviewedRequestGap } from './requests-fixture.ts';
import type { EvidenceArrival, EvidenceRequestInput } from '../src/requests-types.ts';

test('one obligation per request; only explicit revision-bound native arrivals discharge it and old keys never hide current gaps', async t => {
  const { client, packet, evidence, finding, gap, pmRoot } = await requestsFixture(t);
  const initial = queue(await reviewEvidenceRequests(client, packet));
  assert.equal(initial.requests.length, 2);
  assert.deepEqual(initial.requests.map(row => [row.obligation, row.missing]), [['finding', 'source'], ['AC1', 'test']]);
  assert.deepEqual(initial.requests.map(row => row.version), [1, 1]);
  assert.equal(initial.requests[0].path, 'src/input.ts');
  assert.equal(initial.requests[0].line, 12);
  assert.equal(initial.characters, JSON.stringify(initial).length);
  const before = await readFile(getHistoryPath(pmRoot, finding), 'utf8');
  const arrivals: EvidenceArrival[] = initial.requests.map(row => ({ request: row.key, item: evidence, version: 1, field: row.missing === 'source' ? 'files' : 'tests', index: 0 }));
  const bound = { ...packet, arrivals };
  const satisfied = queue(await reviewEvidenceRequests(client, bound));
  assert.equal(satisfied.pending, 0);
  assert.equal(satisfied.satisfied.length, 2);
  assert.equal(satisfied.approval, 'unverified');
  assert.equal(await readFile(getHistoryPath(pmRoot, finding), 'utf8'), before);
  await client.update(evidence, { description: 'New focused source and test artifact.' });
  const changed = queue(await reviewEvidenceRequests(client, bound));
  assert.equal(changed.pending, 2);
  assert.deepEqual(changed.rejected.map(row => row.reason), ['evidence_changed', 'evidence_changed']);
  await client.update(finding, { description: 'Changed obligation while retaining its title.' });
  const old = queue(await reviewEvidenceRequests(client, bound));
  assert.notEqual(old.requests[0].key, initial.requests[0].key);
  assert.ok(old.rejected.some(row => row.reason === 'request_not_current'));
  // Unrelated linked artifacts never implicitly satisfy either selected obligation.
  await client.files(gap, { add: ['path=src/input.ts'] });
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).pending, 2);
});

test('foreign selections and arrivals skip with reasons; explicit evidence requires the exact kind, revision, description and artifact', async t => {
  const { client, packet, evidence, finding, gap } = await requestsFixture(t);
  const initial = queue(await reviewEvidenceRequests(client, packet));
  const key = initial.requests[0].key;
  const base: EvidenceArrival = { request: key, item: evidence, version: 1, field: 'files', index: 0 };
  for (const [change, reason] of [[{ item: 'missing' }, 'evidence_unavailable'], [{ version: 99 }, 'evidence_changed'], [{ field: 'tests' }, 'evidence_type_mismatch'], [{ index: 99 }, 'artifact_missing']] as const) {
    const result = queue(await reviewEvidenceRequests(client, { ...packet, arrivals: [{ ...base, ...change }] }));
    assert.equal(result.pending, 2);
    assert.equal(result.rejected[0].reason, reason);
  }
  const different = (await client.create({ type: 'Task', title: 'Other artifact', description: 'Source excerpt', file: ['path=src/other.ts'] })).item.id;
  assert.equal(queue(await reviewEvidenceRequests(client, { ...packet, arrivals: [{ ...base, item: different }] })).rejected[0].reason, 'source_path_mismatch');
  await client.update(evidence, { description: '' });
  assert.equal(queue(await reviewEvidenceRequests(client, { ...packet, arrivals: [{ ...base, version: 2 }] })).rejected[0].reason, 'artifact_missing');
  const selections = [{ item: 'missing', obligation: 'finding', missing: 'source' }, { item: gap, obligation: 'finding', missing: 'test' }, { item: gap, obligation: 'AC99', missing: 'test' }, { item: finding, obligation: 'AC1', missing: 'test' }];
  assert.deepEqual(queue(await reviewEvidenceRequests(client, { ...packet, select: selections })).skipped.map(row => row.reason), ['item_unavailable', 'not_review_finding', 'criterion_unknown', 'criteria_missing']);
  await client.update(finding, fieldOptions({ review_resolved: true }));
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).skipped[0].reason, 'finding_resolved');
  await client.update(finding, fieldOptions({ review_resolved: false, review_withdrawn: true }));
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).skipped[0].reason, 'finding_resolved');
  await client.update(finding, fieldOptions({ review_withdrawn: false, review_path: 'x'.repeat(257) }));
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).skipped[0].reason, 'source_path_too_large');
});

test('coverage gaps use the existing attention map, not green checks or loose text', async t => {
  const { client, gap, packet } = await requestsFixture(t);
  const { binding } = await reviewedRequestGap(client, gap);
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).skipped[0].reason, 'criterion_reviewed');
  await coverCriterion(client, gap, { ...binding, judgment: 'gap' });
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).pending, 2);
});

test('30-finding fixture has exact count and character omissions, bounded excerpts and finite numeric receipts', async t => {
  const { client, packet } = await requestsFixture(t);
  const select: EvidenceRequestInput['select'] = [];
  for (let index = 0; index < 30; index++) select.push({ item: (await client.create({ type: 'ReviewFinding', title: `Finding ${index}`, ...fieldOptions({ review_summary: `Finding ${index}: ${'x'.repeat(300)}` }), description: 'A substantive unresolved finding' })).item.id, obligation: 'finding', missing: index % 2 ? 'test' : 'source' });
  const full = queue(await reviewEvidenceRequests(client, { ...packet, select }));
  const count = queue(await reviewEvidenceRequests(client, { ...packet, select, budget: { requests: 7, characters: 65536 } }));
  assert.equal(count.requests.length, 7);
  assert.equal(count.omitted.length, 23);
  assert.deepEqual(count.omitted.map(row => row.key), full.requests.slice(7).map(row => row.key));
  assert.ok(count.omitted.every(row => row.reason === 'request_limit'));
  assert.ok(full.requests.every(row => row.text.length === 240 && row.text_omitted > 0));
  const limited = queue(await reviewEvidenceRequests(client, { ...packet, select, budget: { requests: 64, characters: count.characters - 1 } }));
  assert.ok(limited.requests.length < 7);
  assert.ok(limited.omitted.every(row => row.reason === 'character_limit'));
  assert.ok(limited.characters <= count.characters - 1);
  assert.equal(limited.characters, JSON.stringify(limited).length);
  const none = queue(await reviewEvidenceRequests(client, { ...packet, select, budget: { requests: 0, characters: 65536 } }));
  assert.equal(none.requests.length, 0);
  assert.equal(none.omitted.length, 30);
  requestsDenied(await reviewEvidenceRequests(client, { ...packet, select, budget: { requests: 1, characters: 256 } }), 'budget_too_small');
  t.diagnostic(`30 findings: ${count.requests.length} emitted, ${count.omitted.length} exact omissions, ${count.characters} JSON characters; character queue ${limited.requests.length} emitted, ${limited.omitted.length} omitted, ${limited.characters} characters`);
});

test('strict schema rejects sparse arrays, extra keys and extreme values before reading any SDK state', async t => {
  const { client, packet } = await requestsFixture(t);
  const selection = packet.select[0];
  const arrival = { request: 'a'.repeat(64), item: 'sample-source', version: 1, field: 'files', index: 0 };
  const invalid: unknown[] = [null, [], 1, {}, { ...packet, extra: 1 }, { ...packet, schema: 'foreign/v1' }, { ...packet, budget: {} }, { ...packet, select: {} }, { ...packet, arrivals: {} }, { ...packet, select: Array(1) }, { ...packet, arrivals: Array(1) }, { ...packet, select: Array(65).fill(selection) }, { ...packet, arrivals: Array(65).fill(arrival) }, { ...packet, select: [selection, selection] }, { ...packet, arrivals: [arrival, arrival] }];
  for (const row of [null, {}, { ...selection, item: '' }, { ...selection, item: 'x'.repeat(201) }, { ...selection, obligation: 'AC0' }, { ...selection, obligation: 1 }, { ...selection, missing: 'transcript' }, { ...selection, other: '' }]) invalid.push({ ...packet, select: [row] });
  for (const row of [null, {}, { ...arrival, request: '' }, { ...arrival, item: '' }, { ...arrival, field: 'docs' }, { ...arrival, index: 4096 }, { ...arrival, other: '' }]) invalid.push({ ...packet, arrivals: [row] });
  for (const extreme of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined]) {
    invalid.push({ ...packet, budget: { ...packet.budget, requests: extreme } }, { ...packet, budget: { ...packet.budget, characters: extreme } }, { ...packet, arrivals: [{ ...arrival, version: extreme }] }, { ...packet, arrivals: [{ ...arrival, index: extreme }] });
  }
  invalid.push({ ...packet, arrivals: [{ ...arrival, version: 0 }] }, { ...packet, budget: { requests: -1, characters: 0 } });
  for (const value of invalid) requestsDenied(await reviewEvidenceRequests(client, value), 'input_invalid');
  assert.ok(requestInput({ ...packet, arrivals: [arrival] }));
  assert.ok(requestInput({ ...packet, select: [], arrivals: [], budget: { requests: 0, characters: 256 } }));
  assert.equal(requestNumbers({ nested: [Infinity] }), false);
  assert.equal(requestNumbers({ nested: [null, 'word', 0, Number.MAX_SAFE_INTEGER] }), true);
});

test('registered CLI and SDK accept CRLF packets without git and return typed file and packet refusals', async t => {
  const { client, cwd, pmRoot, packet } = await requestsFixture(t);
  const file = join(cwd, 'requests.json');
  await writeFile(file, JSON.stringify(packet, null, 2).replaceAll('\n', '\r\n'));
  const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  const bin = join(cwd, 'empty-bin'); await mkdir(bin);
  const oldPath = process.env.PATH; const oldCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.PATH = bin; process.env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  try {
    const expected = queue(await reviewEvidenceRequests(client, packet));
    const context = { command: 'review requests', args: [], options: { file }, global: { json: true, quiet: true }, pm_root: pmRoot, repo_root: cwd, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') };
    assert.deepEqual((await runReviewCommand(context) as { result: unknown }).result, expected);
    const registered = await runRegisteredCommandForTest(activation.commands, context);
    assert.deepEqual((registered.result as { result: unknown }).result, expected);
    assert.deepEqual(await reviewEvidenceRequestsFile(client, file), expected);
    const refused = await runReviewCommand({ ...context, options: {} }) as { exit_code: number };
    assert.equal(refused.exit_code, 1);
    for (const content of ['{']) { await writeFile(file, content); requestsDenied(await reviewEvidenceRequestsFile(client, file), 'file_unavailable'); }
    await writeFile(file, Buffer.from([0xff])); requestsDenied(await reviewEvidenceRequestsFile(client, file), 'file_unavailable');
    await writeFile(file, '{}'); requestsDenied(await reviewEvidenceRequestsFile(client, file), 'input_invalid');
    await writeFile(file, ' '.repeat(1024 * 1024 + 1)); requestsDenied(await reviewEvidenceRequestsFile(client, file), 'file_unavailable');
    requestsDenied(await reviewEvidenceRequestsFile(client, cwd), 'file_unavailable');
    requestsDenied(await reviewEvidenceRequestsFile(client, join(cwd, 'missing')), 'file_unavailable');
  } finally {
    for (const [key, value] of [['PATH', oldPath], ['GIT_CEILING_DIRECTORIES', oldCeiling]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test('numeric output fuzz refuses unsafe native lines instead of emitting non-finite success', async t => {
  const { client, finding, packet } = await requestsFixture(t);
  for (const line of [-1, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1]) {
    await client.update(finding, fieldOptions({ review_line: line }));
    requestsDenied(await reviewEvidenceRequests(client, packet), 'output_invalid');
  }
  await client.update(finding, fieldOptions({ review_line: 0, review_path: '', review_summary: '' }));
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).requests[0].line, 0);
  // Exercise defensive native-link handling without mocking a PM client.
  const request = queue(await reviewEvidenceRequests(client, packet)).requests[0];
  const snapshot = (await requestSnapshot(client, finding))!;
  assert.equal(arrivalReason({ ...request, missing: 'test' }, { request: request.key, item: finding, version: snapshot.version, field: 'tests', index: 0 }, { ...snapshot, item: { ...snapshot.item, description: 'test artifact', tests: [{ scope: 'project' }] } }), 'artifact_missing');
  assert.equal(arrivalReason(request, { request: request.key, item: finding, version: snapshot.version, field: 'files', index: 0 }, { ...snapshot, item: { ...snapshot.item, description: 'source artifact', files: [{ path: '', scope: 'project' }] } }), 'source_path_mismatch');
});

test('unverifiable, missing, aliased and compacted native histories fail closed or retain original durable versions', async t => {
  const { client, packet, finding, evidence, cwd, pmRoot } = await requestsFixture(t);
  const historyPath = getHistoryPath(pmRoot, evidence);
  const original = await readFile(historyPath, 'utf8');
  const entry = JSON.parse(original.trim()); entry.after_hash = '0'.repeat(64);
  await writeFile(historyPath, JSON.stringify(entry) + '\n');
  assert.equal(await requestSnapshot(client, evidence), undefined);
  await writeFile(historyPath, '');
  assert.equal(await requestSnapshot(client, evidence), undefined);
  await writeFile(historyPath, original);
  assert.equal(await requestSnapshot(client, finding.toUpperCase()), undefined);
  await client.update(finding, { description: 'First successor revision' });
  await client.update(finding, { description: 'Second successor revision' });
  const prior = queue(await reviewEvidenceRequests(client, packet));
  await inFixtureWorkspace(cwd, async () => client.historyCompact(finding, { before: '2', author: 'test-agent' }));
  const compacted = queue(await reviewEvidenceRequests(client, packet));
  assert.ok(compacted.requests[0].version > prior.requests[0].version);
  // Malformed durable files are foreign/unavailable input; the queue never repairs them.
  const itemPath = join(pmRoot, 'review-findings', `${finding}.toon`);
  const native = await readFile(itemPath, 'utf8');
  await writeFile(itemPath, 'foreign invalid document');
  assert.equal(queue(await reviewEvidenceRequests(client, packet)).skipped[0].reason, 'item_unavailable');
  await writeFile(itemPath, native);
});
