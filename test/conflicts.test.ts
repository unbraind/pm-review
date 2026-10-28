import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createExtensionCommandSdk, decodeToon } from '@unbrained/pm-cli/sdk';
import type { PmActionName, PmClient, PmClientRunArgs, SuppressedHostOutput } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension, { reviewConflicts, serializeConflictWitness } from '../index.ts';
import { conflictInput, conflictScope } from '../src/conflict-state.ts';
import { fieldOptions, recordVerdict, reviewItems } from '../src/tracker.ts';
import { findingLineage } from '../src/lineage.ts';
import { runReviewCommand } from '../src/commands.ts';
import type { ConflictCode, ConflictResult } from '../src/conflict-types.ts';
import { addConflictSource, conflictFixture, conflictPacket } from './conflict-fixture.ts';
import { tracker } from './helpers.ts';

/** Expected refusals are bounded data with a stable remedy. */
function refusal(result: ConflictResult, code: ConflictCode): void {
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.refusal.code, code); assert.ok(result.refusal.remedy.length > 30); }
}

/** Retain exact native values before testing one changed metadata boundary. */
async function override(client: PmClient, id: string, fields: Record<string, string | number | boolean>) {
  const previous = (await client.get(id, { full: true })).item;
  await client.update(id, fieldOptions(fields));
  return previous;
}

test('opposed explicit judgments retain both raw sources despite the canonical verdict; neither counts nor withdrawal resolves them', async t => {
  const { client, ids, input } = await conflictFixture(t);
  const before = (await client.listAllComplete()).items;
  const view = conflictPacket(await reviewConflicts(client, input));
  assert.equal(view.state, 'conflict');
  assert.deepEqual(view.judgments.map(row => row.item), ids);
  assert.deepEqual(new Set(view.judgments.map(row => row.verdict)), new Set(['fix', 'refuse']));
  assert.equal(new Set((await reviewItems(client)).map(row => row.review_verdict)).size, 1);
  assert.ok(view.judgments.every(row => row.node && row.provider && row.url && row.version > 1));
  assert.deepEqual(view.missing.map(row => row.kind), ['core_decision', 'resolution_evidence', 'review_availability']);
  assert.equal(view.resolution, 'unverified');
  assert.deepEqual((await client.listAllComplete()).items, before);
  for (const id of ids) await client.update(id, fieldOptions({ review_withdrawn: true }));
  assert.equal(conflictPacket(await reviewConflicts(client, input)).state, 'conflict');
  // Replaying a saved query must read the new native revision, including identical judgments.
  const fresh = conflictPacket(await reviewConflicts(client, input));
  assert.notEqual(fresh.revision, view.revision);
  assert.ok(fresh.judgments.every(row => row.availability === 'withdrawn'));
  await client.update(ids[1], fieldOptions({ review_verdict: 'pending' }));
  assert.equal(conflictPacket(await reviewConflicts(client, input)).state, 'insufficient_evidence');
});

test('only confirmed identity and exact native scope join judgments; legacy explicit dispositions remain readable', async t => {
  const { client, input, ids } = await conflictFixture(t);
  for (const fields of [{ review_head: 'other-revision' }, { review_repo: 'other/package' }, { review_pr: 2 }] as Record<string, string | number | boolean>[]) {
    const old = await override(client, ids[1], fields);
    const view = conflictPacket(await reviewConflicts(client, input));
    assert.equal(view.state, 'no_opposition_observed');
    assert.equal(view.skipped[0].reason, 'scope_mismatch');
    await client.update(ids[1], fieldOptions({ review_head: String(old.review_head), review_repo: String(old.review_repo), review_pr: Number(old.review_pr) }));
  }
  const before = conflictPacket(await reviewConflicts(client, input));
  assert.deepEqual(conflictPacket(await reviewConflicts(client, { ...input, item: `  #${ids[0].toUpperCase()}  ` })), before, 'SDK normalizes operator ids');
  // Unknown foreign comments and duplicate relationships are not lineage confirmations.
  await client.comments(ids[1], { add: 'another-package/v1 {"with":"missing"}' });
  assert.equal(conflictPacket(await reviewConflicts(client, input)).state, 'conflict');
  await client.update(ids[1], { unset: ['review_verdict_source'] });
  assert.equal(conflictPacket(await reviewConflicts(client, input)).state, 'conflict', 'Previously released legacy local decisions still read');
  for (const fields of [{ review_verdict_source: 'import' }, { review_verdict: 'duplicate' }, { review_reason: ' ' }] as Record<string, string | number | boolean>[]) {
    const old = await override(client, ids[1], fields);
    assert.equal(conflictPacket(await reviewConflicts(client, input)).skipped[0].reason, 'not_explicit');
    await client.update(ids[1], fieldOptions({ review_verdict_source: 'local', review_verdict: 'refuse', review_reason: String(old.review_reason).trim() || 'Existing validation covers the boundary' }));
  }
  // Envelope scope comes from the immutable producer fields, not provider artifact ids.
  for (const id of ids) await client.update(id, fieldOptions({ review_head_source: 'envelope', review_origin: 'https://reviews.example.org', review_subject: 'urn:document:boundary', review_head: 'doc-v3' }));
  assert.equal(conflictPacket(await reviewConflicts(client, { ...input, revision: 'doc-v3' })).state, 'conflict');
  assert.equal(conflictPacket(await reviewConflicts(client, { ...input, revision: 'doc-v3' })).scope.kind, 'envelope');
  assert.equal(conflictScope({}, 'revision'), undefined);
  assert.equal((await findingLineage(client, ids[0])).ok, true);
  assert.equal(conflictScope({ review_head_source: 'envelope', review_repo: 'example/package', review_pr: 1 }, 'v1'), undefined, 'A declared envelope never falls back to another target namespace');
});

test('unavailable and malformed individual sources are skipped with missing evidence, never whole-item failures or resolutions', async t => {
  const { client, ids, input } = await conflictFixture(t);
  await client.comments(ids[0], { add: 'review-lineage/v1 {' });
  let view = conflictPacket(await reviewConflicts(client, input));
  assert.equal(view.lineage_issues, 1);
  assert.equal(view.state, 'conflict');
  for (const fields of [{ review_node_id: '' }, { review_bot: '' }, { review_provider: '' }, { review_url: '' }, { review_pr: 0 }, { review_commit: 'x'.repeat(2049) }] as Record<string, string | number | boolean>[]) {
    const old = await override(client, ids[1], fields);
    view = conflictPacket(await reviewConflicts(client, input));
    assert.equal(view.skipped[0].reason, 'source_unavailable');
    assert.equal(view.state, 'insufficient_evidence');
    await client.update(ids[1], { ...fieldOptions({ review_node_id: String(old.review_node_id), review_bot: String(old.review_bot), review_url: String(old.review_url), review_head: String(old.review_head), review_pr: Number(old.review_pr), review_commit: '' }), unset: ['review_provider'] });
  }
  await client.update(ids[1], { unset: ['review_head'] });
  assert.equal(conflictPacket(await reviewConflicts(client, input)).skipped[0].reason, 'source_unavailable');
  await client.update(ids[1], { ...fieldOptions({ review_head: input.revision }), unset: ['review_commit'] });
  assert.equal(conflictPacket(await reviewConflicts(client, input)).judgments.find(row => row.item === ids[1])!.commit, '');
  const broken = new Proxy(client, { get(target, key, receiver) { if (key === 'run') return async (action: PmActionName, args?: PmClientRunArgs) => { if (action === 'history') throw new Error('unavailable native history'); return target.run(action, args); }; return Reflect.get(target, key, receiver); } });
  view = conflictPacket(await reviewConflicts(broken, input));
  assert.equal(view.judgments.length, 0);
  assert.equal(view.skipped.length, 2);
  assert.equal(view.state, 'insufficient_evidence');
  for (const failAt of [0, 1]) {
    let reads = 0;
    const unavailable = new Proxy(client, { get(target, key, receiver) { if (key === 'listAllComplete') return async () => { if (reads++ === failAt) throw new Error('unavailable complete corpus'); return target.listAllComplete(); }; return Reflect.get(target, key, receiver); } });
    refusal(await reviewConflicts(unavailable, input), failAt === 0 ? 'finding_unavailable' : 'state_changed');
  }
  let firstRead = true;
  const movedScope = new Proxy(client, { get(target, key, receiver) { if (key === 'listAllComplete') return async () => { if (firstRead) { firstRead = false; await target.update(ids[0], fieldOptions({ review_pr: 0 })); } return target.listAllComplete(); }; return Reflect.get(target, key, receiver); } });
  refusal(await reviewConflicts(movedScope, input), 'state_changed');
});

test('one strict input boundary refuses extreme values before reads and permits historical selectors without new content restrictions', async t => {
  const { client, input, ids } = await conflictFixture(t);
  const noRead = new Proxy(client, { get() { assert.fail('Invalid input reached the SDK'); } });
  const invalid: unknown[] = [null, [], true, 1, {}, { ...input, extra: 1 }, { ...input, schema: 'other' }, { ...input, item: '' }, { ...input, item: ' ' }, { ...input, item: 'x'.repeat(513) }, { ...input, revision: '' }, { ...input, revision: ' \r\n ' }, { ...input, revision: 'x'.repeat(2049) }];
  for (const key of ['schema', 'item', 'revision']) { const row: Record<string, unknown> = { ...input, extra: true }; delete row[key]; invalid.push(row); }
  for (const number of [NaN, Infinity, -Infinity, -1, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER]) for (const key of ['item', 'revision', 'schema']) invalid.push({ ...input, [key]: number });
  for (const row of invalid) refusal(await reviewConflicts(noRead, row), 'input_invalid');
  for (const selector of ['constructor', '__proto__', 'old.identifier', '  #legacy-id  ']) assert.ok(conflictInput({ ...input, item: selector }));
  refusal(await reviewConflicts(client, { ...input, item: 'missing' }), 'finding_unavailable');
  const task = (await client.create({ type: 'Task', title: 'Foreign ordinary item', parent: 'none' })).item;
  refusal(await reviewConflicts(client, { ...input, item: task.id }), 'finding_unavailable');
  for (const review_pr of [Infinity, -Infinity, NaN, 0, -1, Number.MAX_VALUE]) assert.equal(conflictScope({ review_repo: 'example/package', review_pr }, input.revision), undefined);
  await client.update(ids[0], fieldOptions({ review_pr: 0 }));
  refusal(await reviewConflicts(client, input), 'scope_unavailable');
});

test('compact JSON/TOON round trips, Unicode omissions, exact output bounds and registered command refusal exits agree', async t => {
  const { client, input, ids, pmRoot, cwd } = await conflictFixture(t);
  await recordVerdict(client, (await client.listAllComplete()).items.find(row => row.id === ids[0])!, 'fix', '😀'.repeat(500), 'c'.repeat(40));
  const view = conflictPacket(await reviewConflicts(client, input));
  assert.equal(view.judgments[0].reason_omitted, 1040);
  assert.deepEqual(JSON.parse(serializeConflictWitness(view)), view);
  assert.deepEqual(decodeToon(serializeConflictWitness(view, 'toon')), view);
  assert.ok(Buffer.byteLength(serializeConflictWitness(view, 'toon')) < 5000);
  const active = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
  const sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
  const missingItem = await runRegisteredCommandForTest(active.commands, { command: 'review conflicts', args: [], options: { revision: input.revision }, pmRoot, sdk, global: { quiet: true } });
  assert.equal((missingItem.result as { exit_code: number }).exit_code, 1);
  for (const options of [{ revision: input.revision }, {}]) {
    const result = await runRegisteredCommandForTest(active.commands, { command: 'review conflicts', args: [ids[0]], options, pmRoot, sdk, global: { quiet: true } });
    if ('revision' in options) assert.equal(((result.result as SuppressedHostOutput).result as ConflictResult).ok, true);
    else assert.equal((result.result as { exit_code: number }).exit_code, 1);
  }
  const fresh = await tracker(t);
  assert.equal((await fresh.client.listAllComplete()).items.length, 0);
  const emptyBin = join(cwd, 'no-git-bin'); await mkdir(emptyBin);
  const previous = new Map([['PATH', process.env.PATH], ['GIT_CEILING_DIRECTORIES', process.env.GIT_CEILING_DIRECTORIES]]);
  process.env.PATH = emptyBin; process.env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  try {
    for (const global of [{}, { json: true }, { outputFormat: 'toon' as const }, { defaultOutputFormat: 'json' as const }, { quiet: true }]) {
      let stdout = '';
      const capture = t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => { stdout += String(chunk); return true; });
      try {
        const returned = await runReviewCommand({ command: 'review conflicts', args: [ids[0]], options: { revision: input.revision }, global, pm_root: pmRoot, repo_root: cwd }) as SuppressedHostOutput;
        assert.deepEqual(returned.result, view);
        if (!('quiet' in global)) assert.deepEqual('json' in global || 'defaultOutputFormat' in global ? JSON.parse(stdout) : decodeToon(stdout), view);
        else assert.equal(stdout, '');
      } finally { capture.mock.restore(); }
    }
  } finally {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test('repeated provider votes cannot settle opposition and oversized packets refuse with remedies', async t => {
  const { client, input, ids } = await conflictFixture(t);
  for (let index = 0; index < 12; index++) await addConflictSource(client, ids[0], index, true);
  refusal(await reviewConflicts(client, input), 'output_invalid');
  for (const item of (await client.listAllComplete()).items) await client.update(item.id, fieldOptions({ review_url: 'legacy:source', review_node_id: `legacy:${item.id}`, review_commit: '' }));
  const view = conflictPacket(await reviewConflicts(client, input));
  assert.equal(view.judgments.filter(row => row.verdict === 'fix').length, 13);
  assert.equal(view.judgments.filter(row => row.verdict === 'refuse').length, 1);
  assert.equal(view.state, 'conflict');
  for (let index = 12; index < 31; index++) await addConflictSource(client, ids[0], index);
  refusal(await reviewConflicts(client, input), 'lineage_too_large');
});
