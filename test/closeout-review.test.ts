import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { closeoutChanges } from '../src/closeout-state.ts';
import { detectGaming } from '../src/closeout-detectors.ts';
import { reviewCloseout, checkInvocation } from '../src/closeout.ts';
import type { CloseoutChange, CloseoutReport } from '../src/closeout-types.ts';
import { tracker, inFixtureWorkspace } from './helpers.ts';

/** Execute argument-only fixture Git commands with a synthetic commit identity. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Link a named assertion while preserving and restoring the caller's intake context. */
async function linkProof(client: PmClient, id: string, cwd: string): Promise<void> {
  await inFixtureWorkspace(cwd, () => client.run('test', { id, options: { add: [`command=${process.execPath} --test --test-reporter=tap case.test.ts,path=case.test.ts`] } }));
}

test('review regression: a plain tracker inside a repository subdirectory executes without cloning its parent', async t => {
  const parent = await tracker(t);
  const cwd = join(parent.cwd, 'package');
  mkdirSync(cwd);
  const pmRoot = join(cwd, '.agents/pm');
  const client = new PmClient({ cwd, pmRoot, author: 'test-agent', noExtensions: true });
  await client.init('nested', { defaults: true, mergeFence: false, agentGuidance: 'skip' });
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; test('nested proof', () => {});\n");
  writeFileSync(join(cwd, 'guide.md'), 'current');
  const { item } = await client.create({ type: 'Task', title: 'Nested proof', acceptanceCriteria: '[test:nested proof]' });
  await client.files(item.id, { add: [`path=guide.md,note=closeout-before:${Buffer.from('previous').toString('base64')}`] });
  await linkProof(client, item.id, cwd);
  // Existing plain-tracker evidence stays branch-independent when placed below a repository.
  git(parent.cwd, 'init', '-q');
  const receipt = await reviewCloseout(client, item.id, { cwd, pmRoot });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(receipt.commands[0].result, 'passed');
});

test('review regression: staged and committed renames retain deleted tests and both source paths', async t => {
  const { cwd } = await tracker(t);
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, 'test'));
  const tests = Array.from({ length: 20 }, (_, index) => `test('case ${index}', () => {});`).join('\n');
  writeFileSync(join(cwd, 'test/old.test.ts'), tests);
  writeFileSync(join(cwd, 'old.ts'), 'export function result() { return 1; }\n');
  git(cwd, 'add', 'test/old.test.ts', 'old.ts');
  git(cwd, 'commit', '-qm', 'baseline');
  const base = git(cwd, 'rev-parse', 'HEAD');
  renameSync(join(cwd, 'test/old.test.ts'), join(cwd, 'test/new.test.ts'));
  renameSync(join(cwd, 'old.ts'), join(cwd, 'new.ts'));
  writeFileSync(join(cwd, 'test/new.test.ts'), tests.split('\n').slice(1).join('\n'));
  git(cwd, 'add', 'test', 'old.ts', 'new.ts');
  for (const committed of [false, true]) {
    if (committed) git(cwd, 'commit', '-qm', 'rename');
    assert.match(git(cwd, 'diff', '--name-status', '--find-renames', base), /R\d+\s/);
    const { changes } = closeoutChanges(cwd, {}, base, []);
    assert.ok(detectGaming(changes).some(row => row.code === 'test_deleted' && row.file === 'test/old.test.ts'));
    assert.deepEqual(changes.filter(row => ['old.ts', 'new.ts'].includes(row.file)).sort((a, b) => a.file.localeCompare(b.file)), [
      { file: 'new.ts', before: null, after: 'export function result() { return 1; }\n' },
      { file: 'old.ts', before: 'export function result() { return 1; }\n', after: null },
    ]);
  }
});

test('review regression: opaque repository entries produce receipts and retain policy and test findings', async t => {
  const { cwd, client, pmRoot } = await tracker(t);
  git(cwd, 'init', '-q');
  for (const [file, text] of [['image.png', '\0old'], ['large.lock', 'x'.repeat(1_000_001)], ['huge.lock', 'x'.repeat(8_000_001)], ['case.test.ts', "test('lost', () => {});"], ['stable.txt', 'stable']]) writeFileSync(join(cwd, file), text);
  symlinkSync('stable.txt', join(cwd, 'tracked-link'));
  git(cwd, 'add', 'image.png', 'large.lock', 'huge.lock', 'case.test.ts', 'stable.txt', 'tracked-link');
  git(cwd, 'commit', '-qm', 'baseline');
  const base = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'update-index', '--add', '--cacheinfo', `160000,${base},submodule`);
  mkdirSync(join(cwd, 'submodule'));
  for (const file of ['image.png', 'large.lock', 'huge.lock']) writeFileSync(join(cwd, file), 'new');
  writeFileSync(join(cwd, 'case.test.ts'), '\0');
  writeFileSync(join(cwd, 'new.test.ts'), '\0');
  writeFileSync(join(cwd, 'eslint.config.ts'), '\0');
  writeFileSync(join(cwd, 'new-large.lock'), 'x'.repeat(1_000_001));
  symlinkSync('stable.txt', join(cwd, 'untracked-link'));
  renameSync(join(cwd, 'tracked-link'), join(cwd, 'previous-link'));
  symlinkSync('image.png', join(cwd, 'tracked-link'));
  const skipped: { check: string; reason: string }[] = [];
  let state: { baseline: string; changes: CloseoutChange[] } = { baseline: '', changes: [] };
  assert.doesNotThrow(() => { state = closeoutChanges(cwd, {}, base, skipped); });
  for (const file of ['image.png', 'large.lock', 'huge.lock', 'case.test.ts', 'new.test.ts', 'eslint.config.ts', 'new-large.lock', 'tracked-link', 'untracked-link', 'submodule']) {
    assert.equal(state.changes.find(row => row.file === file)?.opaque, true, file);
    assert.ok(skipped.some(row => row.check === `diff:${file}`), file);
  }
  const findings = detectGaming(state.changes);
  assert.ok(findings.some(row => row.code === 'gate_changed' && row.file === 'eslint.config.ts'));
  for (const file of ['case.test.ts', 'new.test.ts']) assert.ok(findings.some(row => row.code === 'execution_unverified' && row.file === file));
  const { item } = await client.create({ type: 'Task', title: 'Opaque diff receipt' });
  const receipt = await reviewCloseout(client, item.id, { cwd, pmRoot, base });
  assert.equal(receipt.ok, false);
  assert.ok(receipt.skipped.some(row => row.check === 'diff:submodule'));
});

test('review regression: opaque source cannot gain invocation proof or become a revert baseline', async t => {
  const { cwd, client, pmRoot } = await tracker(t);
  git(cwd, 'init', '-q');
  writeFileSync(join(cwd, 'source.ts'), '\0');
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; test('proof', () => {});\n");
  git(cwd, 'add', 'source.ts', 'case.test.ts');
  git(cwd, 'commit', '-qm', 'baseline');
  writeFileSync(join(cwd, 'source.ts'), 'export function result() { return 2; }');
  const { item } = await client.create({ type: 'Task', title: 'Opaque baseline', acceptanceCriteria: '[test:proof]' });
  await linkProof(client, item.id, cwd);
  const receipt = await reviewCloseout(client, item.id, { cwd, pmRoot, base: 'HEAD', revertCheck: true });
  assert.equal(receipt.commands[0].result, 'passed', JSON.stringify(receipt));
  assert.equal(receipt.revert_check, 'inconclusive');
  assert.ok(receipt.findings.some(row => row.code === 'revert_inconclusive'));
  const isolated: CloseoutReport = { ...receipt, findings: [] };
  checkInvocation([{ file: 'source.ts', before: '', after: '\0opaque', opaque: true }], { error: '', runs: [], functions: [{ file: 'source.ts', start: 0, end: 100, count: 1 }] }, isolated);
  assert.deepEqual(isolated.findings.map(row => row.code), ['execution_unverified']);
});
