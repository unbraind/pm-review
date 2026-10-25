import '../src/scope-types.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk, locateItem } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import { captureReviewScope, carryForwardReview } from '../src/scope.ts';
import { historicalItem, scopeDigest } from '../src/scope-state.ts';
import { reviewScopeFile } from '../src/scope-file.ts';
import { runReviewCommand } from '../src/commands.ts';
import type { ReviewScope, CarryForwardReport } from '../src/scope-types.ts';
import { scopeFixture, scopeDenied } from './scope-fixture.ts';

test('unrelated edits preserve scoped attention, touched evidence stales only dependent judgments, never granting approval', async t => {
  const { client, id, evidence, selection, pmRoot } = await scopeFixture(t);
  const baseline = await captureReviewScope(client, id, selection) as ReviewScope;
  assert.equal(baseline.ok, true);
  const historyBefore = await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8');
  const unchanged = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.deepEqual(unchanged.counts, { unchanged: 2, stale: 0, never_reviewed: 1, removed: 0 });
  assert.equal(unchanged.artifact_changed, false);
  assert.equal(unchanged.approval, 'unverified');
  assert.equal(await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8'), historyBefore);
  await client.update(id, { priority: 1 });
  const unrelated = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.equal(unrelated.artifact_changed, true);
  assert.deepEqual(unrelated.counts, unchanged.counts);
  await client.update(evidence, { description: 'Touched review evidence invalidates the old judgment.' });
  const changed = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.deepEqual(changed.counts, { unchanged: 1, stale: 1, never_reviewed: 1, removed: 0 });
  assert.deepEqual(changed.obligations[0].reasons, [`evidence_changed:${evidence}`]);
  await client.update(id, { description: 'Changed validation', acceptanceCriteria: 'Reject more invalid values; Preserve valid values; Track missing review; New review obligation' });
  const artifact = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.deepEqual(artifact.obligations[0].reasons, ['criterion_changed', 'field_changed:description', `evidence_changed:${evidence}`]);
  assert.deepEqual(artifact.counts, { unchanged: 1, stale: 1, never_reviewed: 2, removed: 0 });
  await client.update(id, { acceptanceCriteria: 'Reject more invalid values' });
  const removed = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.equal(removed.counts.removed, 2);
  assert.deepEqual(removed.obligations.at(-1)!.reasons, ['criterion_removed']);
  assert.equal(removed.approval, 'unverified');
  assert.ok(Buffer.byteLength(JSON.stringify(changed)) < 1200);
});

test('only explicit reviewed obligations count; omitted and gap criteria remain never reviewed, including empty contracts', async t => {
  const { client, id, evidence, selection } = await scopeFixture(t);
  assert.equal((await captureReviewScope(client, evidence, { ...selection, obligations: [] })).ok, true);
  const baseline = await captureReviewScope(client, id, { ...selection, obligations: [] });
  const report = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.equal(report.counts.never_reviewed, 3);
  await client.update(id, { acceptanceCriteria: '' });
  const removed = await carryForwardReview(client, id, await captureReviewScope(client, id, selection)) as CarryForwardReport;
  assert.equal(removed.counts.removed, 3);
  const empty = await captureReviewScope(client, id, { ...selection, version: 2, obligations: [] });
  assert.deepEqual((await carryForwardReview(client, id, empty) as CarryForwardReport).counts, { unchanged: 0, stale: 0, never_reviewed: 0, removed: 0 });
});

test('malformed and foreign declarations have typed remedies and never modify the tracker', async t => {
  const { client, id, selection } = await scopeFixture(t);
  const before = (await client.get(id, { full: true })).item;
  const row = selection.obligations[0];
  const badRows = [null, {}, { ...row, criterion: 1 }, { ...row, criterion: 'AC0' }, { ...row, judgment: 'approved' }, { ...row, fields: undefined }, { ...row, fields: [] }, { ...row, fields: Array.from({ length: 17 }, (_, i) => `field${i}`) }, { ...row, fields: [1] }, { ...row, fields: ['__proto__'] }, { ...row, fields: ['description', 'description'] }, { ...row, evidence: {} }, { ...row, evidence: Array(17).fill({ id: 'source', version: 1 }) }, ...[null, {}, { id: '', version: 1 }, { id: 'source', version: 0 }, { id: 'source', version: 1.5 }].map(source => ({ ...row, evidence: [source] })), { ...row, evidence: [row.evidence[0], row.evidence[0]] }];
  const badSelections: unknown[] = [null, 1, {}, { ...selection, version: 0 }, { ...selection, version: 1.5 }, { ...selection, author: '' }, { ...selection, author: 1 }, { ...selection, author: 'a'.repeat(201) }, { ...selection, reason: 2 }, { ...selection, reason: 'short' }, { ...selection, reason: 'a'.repeat(1001) }, { ...selection, obligations: {} }, { ...selection, obligations: Array(33).fill(row) }, { ...selection, obligations: [row, row] }, ...badRows.map(invalid => ({ ...selection, obligations: [invalid] }))];
  for (const value of badSelections) scopeDenied(await captureReviewScope(client, id, value), 'scope_invalid');
  const scope = await captureReviewScope(client, id, selection) as ReviewScope;
  for (const value of [null, {}, { ...scope, schema: 'foreign/v1' }, { ...scope, obligations: {} }, { ...scope, obligations: [null] }, { ...scope, obligations: [{ ...scope.obligations[0], fields: [null] }] }]) scopeDenied(await carryForwardReview(client, id, value), 'scope_invalid');
  scopeDenied(await captureReviewScope(client, id, { ...selection, obligations: [{ ...row, criterion: 'AC99' }] }), 'criterion_unknown');
  scopeDenied(await captureReviewScope(client, id, { ...selection, obligations: [{ ...row, fields: ['constructor'] }] }), 'field_unknown');
  scopeDenied(await captureReviewScope(client, 'missing', selection), 'history_unavailable');
  scopeDenied(await captureReviewScope(client, id, { ...selection, version: 999999 }), 'history_unavailable');
  scopeDenied(await captureReviewScope(client, id, { ...selection, obligations: [{ ...row, evidence: [{ id: 'missing', version: 1 }] }] }), 'history_unavailable');
  scopeDenied(await carryForwardReview(client, id, { ...scope, artifact: 'forged' }), 'baseline_changed');
  scopeDenied(await carryForwardReview(client, 'missing', scope), 'history_unavailable');
  assert.deepEqual((await client.get(id, { full: true })).item, before);
  assert.equal(scopeDigest({ z: 1, a: { y: ' \r\n', x: [] } }), scopeDigest({ a: { x: [], y: ' \r\n' }, z: 1 }));
});

test('missing current evidence stales attention; missing current artifact refuses; foreign comments are ignored', async t => {
  const { client, id, evidence, selection, pmRoot } = await scopeFixture(t);
  const baseline = await captureReviewScope(client, id, selection);
  const sourcePath = (await locateItem(pmRoot, evidence))!.itemPath;
  await rename(sourcePath, `${sourcePath}.held`);
  try { assert.equal((await carryForwardReview(client, id, baseline) as CarryForwardReport).counts.stale, 1); }
  finally { await rename(`${sourcePath}.held`, sourcePath); }
  await client.comments(id, { add: 'foreign-provider/v1 malformed payload' });
  await client.delete(evidence);
  const report = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.equal(report.counts.stale, 1);
  await client.delete(id);
  scopeDenied(await carryForwardReview(client, id, baseline), 'scope_unavailable');
  // Historical evidence stays readable after soft deletion: core owns version semantics.
  assert.ok(await historicalItem(client, id, 1));
});

test('bounded UTF-8 receipt files and registered commands run without git and preserve state through JSON replays', async t => {
  const { client, id, cwd, pmRoot, selection } = await scopeFixture(t);
  const file = join(cwd, 'selection.json');
  await writeFile(file, JSON.stringify(selection, null, 2).replaceAll('\n', '\r\n'));
  const bin = join(cwd, 'empty-bin');
  await mkdir(bin);
  const previousPath = process.env.PATH;
  const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.PATH = bin;
  process.env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  try {
    const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
    assert.deepEqual(activation.failed, []);
    const sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
    const scope = await runRegisteredCommandForTest(activation.commands, { command: 'review scope', args: [id], options: { file }, pmRoot, sdk });
    assert.equal(scope.handled, true);
    const baseline = scope.result as ReviewScope;
    assert.equal(baseline.ok, true);
    const ctx = { command: 'review carry-forward', args: [id], options: { file }, global: {}, pm_root: pmRoot, repo_root: cwd };
    await writeFile(file, JSON.stringify(baseline));
    assert.equal((await runReviewCommand(ctx) as CarryForwardReport).counts.unchanged, 2);
    const compared = await runRegisteredCommandForTest(activation.commands, { command: 'review carry-forward', args: [id], options: { file }, pmRoot, sdk });
    assert.equal((compared.result as CarryForwardReport).approval, 'unverified');
    const targetBefore = (await client.get(id, { full: true })).item;
    for (let replay = 0; replay < 3; replay++) assert.equal((await reviewScopeFile(client, id, file, false) as CarryForwardReport).counts.unchanged, 2);
    assert.deepEqual((await client.get(id, { full: true })).item, targetBefore);
    await writeFile(file, '{}');
    assert.equal((await runReviewCommand(ctx) as { exit_code: number }).exit_code, 1);
    scopeDenied(await reviewScopeFile(client, id, file, true), 'scope_invalid');
    for (const bytes of ['{bad', 'x'.repeat(1024 * 1024 + 1), Buffer.from([0xff])]) {
      await writeFile(file, bytes);
      scopeDenied(await reviewScopeFile(client, id, file, true), 'scope_unavailable');
    }
    scopeDenied(await reviewScopeFile(client, id, cwd, false), 'scope_unavailable');
    scopeDenied(await reviewScopeFile(client, id, join(cwd, 'missing'), true), 'scope_unavailable');
    assert.equal((await runReviewCommand({ ...ctx, args: [], options: {} }) as { exit_code: number }).exit_code, 1);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
  }
});
