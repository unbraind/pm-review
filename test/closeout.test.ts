import '../src/closeout-types.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { commitImportedItem, locateItem, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import { reviewCloseout } from '../src/closeout.ts';
import { artifactPath, artifactText, closeoutChanges, hasGit } from '../src/closeout-state.ts';
import { detectGaming, namedTests } from '../src/closeout-detectors.ts';
import { boundedHost, executeCloseout } from '../src/closeout-run.ts';
import { runReviewCommand } from '../src/commands.ts';
import { tracker } from './helpers.ts';

/** Create fixture source and directly instrumented named behavior tests. */
function sourceFiles(cwd: string): void {
  writeFileSync(join(cwd, 'source.ts'), '/** Return the fixed result. */\nexport function result() { return 2; }\n');
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { result } from './source.ts'; test('returns fixed result', () => assert.equal(result(), 2));\n");
}

/** Bind fixture tests through real SDK mutations with recorded non-git source state. */
async function closeoutFixture(t: Parameters<typeof tracker>[0]) {
  const setup = await tracker(t);
  sourceFiles(setup.cwd);
  const item = (await setup.client.create({ type: 'Task', title: 'Check fixed result', acceptanceCriteria: '[test:returns fixed result]' })).item;
  const before = Buffer.from('/** Return the fixed result. */\nexport function result() { return 1; }\n').toString('base64');
  await setup.client.files(item.id, { add: [`path=source.ts,note=closeout-before:${before}`] });
  await setup.client.run('test', { id: item.id, options: { add: [`command=${process.execPath} --test --test-reporter=tap case.test.ts,path=case.test.ts`] } });
  return { ...setup, id: item.id, options: { cwd: setup.cwd, pmRoot: setup.pmRoot, timeoutSeconds: 60 } };
}

test('plain tracker fresh evidence proves criterion and revert demonstrates sensitivity without source writes', async t => {
  const { client, id, options, cwd, pmRoot } = await closeoutFixture(t);
  const before = readFileSync(join(pmRoot, 'tasks', `${id}.toon`), 'utf8');
  const report = await reviewCloseout(client, id, { ...options, revertCheck: true });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.criteria[0].verdict, 'proven');
  assert.equal(report.revert_check, 'sensitive');
  assert.equal(readFileSync(join(pmRoot, 'tasks', `${id}.toon`), 'utf8'), before);
  assert.match(readFileSync(join(cwd, 'source.ts'), 'utf8'), /return 2/);
});

test('gamed passing test never calling changed function is detected and survives revert', async t => {
  const { client, id, options, cwd } = await closeoutFixture(t);
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; import './source.ts'; test('returns fixed result', () => {});\n");
  const report = await reviewCloseout(client, id, { ...options, revertCheck: true });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(row => row.code === 'source_unexecuted'), JSON.stringify(report));
  assert.ok(report.findings.some(row => row.code === 'revert_survived'));
});

test('TAP parsing never promotes skips, pending or failed assertions', () => {
  assert.deepEqual(namedTests('ok 1 - happy\nnot ok 2 - broken\nok 3 - pending # SKIP reason\nok 4 - todo # TODO later\nEXIT:0', 2), [
    { name: 'happy', result: 'passed', command: 2 }, { name: 'broken', result: 'failed', command: 2 }, { name: 'pending', result: 'skipped', command: 2 }, { name: 'todo', result: 'skipped', command: 2 },
  ]);
  assert.deepEqual(namedTests('✔ proof (2.0ms)\n✖ failure (1.0ms)\n﹣ ignored (0.0ms)\n✓ bun proof [0.25ms]\n✗ bun failure [2.0ms]\n✔ later (1.0ms) # TODO reason', 1).map(row => row.result), ['passed', 'failed', 'skipped', 'passed', 'failed', 'skipped']);
});

test('gaming detector catches coverage and lint reductions, unknown policy edits and lost test cases', () => {
  const cases = [
    { file: 'package.json', before: '{"coverageGate":{"thresholds":{"lines":100}}}', after: '{"coverageGate":{"thresholds":{"lines":90}}}' },
    { file: '.eslintrc.json', before: '{"rules":{"guard":"error"}}', after: '{"rules":{"guard":"off"}}' },
    { file: 'eslint.config.ts', before: 'error', after: 'off' },
    { file: 'vitest.config.ts', before: 'thresholds: { lines: 100, functions: 100 }', after: 'thresholds: { lines: 50, functions: 100 }' },
    { file: 'jest.config.ts', before: 'lines: 100', after: 'thresholdFromEnvironment' },
    { file: 'coverage.json', before: '{"thresholds":{}}', after: '{}' },
    { file: 'c8.json', before: 'broken', after: 'also broken' },
    { file: 'jest.config.js', before: null, after: 'config' },
    { file: 'coverage.json', before: '{}', after: null },
    { file: 'test/case.ts', before: 'test("original", () => {});', after: 'test.skip("new", () => {}); test.only("focus", () => {});' },
    { file: 'test/deleted.ts', before: 'test("lost", () => {});', after: null },
    { file: 'source.ts', before: 'a', after: 'b' },
    { file: 'package.json', before: '{"version":1,"name":"old"}', after: '{"version":2,"name":"new"}' },
    { file: 'test/same.ts', before: 'same', after: 'same' },
    { file: 'test/added.ts', before: null, after: 'it("added", () => {});' },
  ];
  const codes = detectGaming(cases).map(row => row.code);
  for (const code of ['threshold_lowered', 'gate_changed', 'test_skipped', 'test_focused', 'test_deleted']) assert.ok(codes.includes(code as typeof codes[number]), code);
});

test('artifacts reject traversal, symlinks, directories, oversized and binary evidence', async t => {
  const { cwd } = await tracker(t);
  assert.equal(hasGit(cwd), false);
  writeFileSync(join(cwd, 'guide.md'), 'current');
  const skips: { check: string; reason: string }[] = [];
  assert.equal(closeoutChanges(cwd, { docs: [{ path: 'guide.md', scope: 'project', note: 'closeout-before:' + Buffer.from('old').toString('base64') }] }, undefined, skips).changes.length, 1);
  closeoutChanges(cwd, {}, undefined, []);
  assert.equal(artifactText(cwd, 'absent'), null);
  for (const file of ['..', '../outside', cwd, '.']) assert.throws(() => artifactPath(cwd, file), /relative/);
  symlinkSync('missing', join(cwd, 'dangling'));
  symlinkSync(cwd, join(cwd, 'linked'));
  assert.throws(() => artifactPath(cwd, 'linked/file'), /symlink/);
  assert.throws(() => artifactPath(cwd, 'dangling'), /symlink/);
  mkdirSync(join(cwd, 'directory'));
  assert.throws(() => artifactText(cwd, 'directory'), /text file/);
  writeFileSync(join(cwd, 'large'), 'x'.repeat(1_000_001));
  assert.throws(() => artifactText(cwd, 'large'), /megabyte/);
  writeFileSync(join(cwd, 'binary'), '\0');
  assert.throws(() => artifactText(cwd, 'binary'), /Binary/);
});

test('git comparison includes tracked deletes, additions, edits and rejects invalid base', async t => {
  const { cwd, client } = await tracker(t);
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(cwd, 'original.ts'), 'before');
  execFileSync('git', ['add', 'original.ts'], { cwd });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline'], { cwd });
  assert.equal(hasGit(cwd), true);
  writeFileSync(join(cwd, 'original.ts'), 'after');
  writeFileSync(join(cwd, 'added.ts'), 'added');
  const item = (await client.create({ type: 'Task', title: 'Read baseline' })).item;
  const state = closeoutChanges(cwd, item, 'HEAD', []);
  assert.equal(state.changes.find(row => row.file === 'original.ts')!.before, 'before');
  assert.equal(state.changes.find(row => row.file === 'added.ts')!.before, null);
  assert.throws(() => closeoutChanges(cwd, item, '--bad', []), /resolve to a commit/);
  mkdirSync(join(cwd, 'nested'));
  assert.throws(() => closeoutChanges(join(cwd, 'nested'), item, 'HEAD', []), /repository root/);
});

test('missing criteria, artifacts, baseline and EXIT claims never pass', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'No evidence' })).item;
  await client.comments(item.id, { add: 'EXIT:0 all done' });
  await client.files(item.id, { add: ['missing.ts'] });
  const report = await reviewCloseout(client, item.id, { cwd, pmRoot, base: 'HEAD', revertCheck: true });
  assert.equal(report.ok, false);
  for (const code of ['baseline_missing', 'artifact_missing', 'execution_missing', 'revert_inconclusive']) assert.ok(report.findings.some(row => row.code === code));
  assert.equal(report.criteria.length, 0);
  await assert.rejects(reviewCloseout(client, item.id, { cwd, pmRoot, timeoutSeconds: 0 }), /timeout/);
  await assert.rejects(reviewCloseout(client, item.id, { cwd, pmRoot, timeoutSeconds: 601 }), /timeout/);
});

test('bounded host refuses absent, malformed, overlarge and timed out evidence', async t => {
  const { cwd } = await tracker(t);
  for (const script of ['console.log("bad")', 'console.log("{}")']) assert.match((await boundedHost(['-e', script], cwd, 3000)).error, /no execution evidence/);
  assert.match((await boundedHost(['-e', 'setInterval(() => {}, 1000)'], cwd, 30)).error, /budget exceeded/);
  assert.match((await boundedHost(['-e', 'process.stdout.write("x".repeat(2100000)); setInterval(() => {}, 1000)'], cwd, 3000)).error, /output limit/);
  assert.match((await boundedHost(['-e', ''], join(cwd, 'missing'), 3000)).error, /could not start/);
  const preparation = await executeCloseout((await tracker(t)).client, 'missing', { cwd: join(cwd, 'missing'), pmRoot: cwd });
  assert.match(preparation.error, /could not be prepared/);
  const result = await boundedHost(['-e', 'console.log(JSON.stringify({run_results:[]}))'], cwd, 3000);
  assert.equal(result.error, '');
});

test('registered closeout dispatch uses SDK context and emits nonzero for incomplete evidence', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'Review empty task', acceptanceCriteria: 'No proof' })).item;
  const result = await runReviewCommand({ command: 'review closeout', args: [item.id], options: { timeout: '10' }, global: {}, pm_root: pmRoot, source_workspace_root: cwd });
  assert.equal((result as { exit_code: number }).exit_code, 1);
  const result2 = await runReviewCommand({ command: 'review closeout', args: [item.id], options: {}, global: {}, pm_root: pmRoot, repo_root: cwd });
  assert.equal((result2 as { ok: boolean }).ok, false);
  await runReviewCommand({ command: 'review closeout', args: [item.id], options: {}, global: {}, pm_root: pmRoot });
  await assert.rejects(runReviewCommand({ command: 'review closeout', args: [], options: {}, global: {}, pm_root: pmRoot }), /id|item|not found/i);
});

test('no-git tracker works with a PATH containing no git and a discovery ceiling', async t => {
  const { client, id, options, cwd } = await closeoutFixture(t);
  const bin = join(cwd, 'empty-bin');
  mkdirSync(bin);
  const priorSource = process.env.PM_SOURCE_WORKSPACE_ROOT;
  process.env.PM_SOURCE_WORKSPACE_ROOT = join(cwd, 'incorrect-outer-workspace');
  const priorPath = process.env.PATH;
  const priorCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.PATH = bin;
  process.env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  try {
    const report = await reviewCloseout(client, id, options);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.equal(report.revert_check, 'not_requested');
  } finally {
    if (priorSource === undefined) delete process.env.PM_SOURCE_WORKSPACE_ROOT; else process.env.PM_SOURCE_WORKSPACE_ROOT = priorSource;
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = priorCeiling;
  }
});

test('criterion mappings retain comment ids and require every explicitly named assertion', async t => {
  const { client, id, options } = await closeoutFixture(t);
  await client.update(id, { acceptanceCriteria: 'The fixed result is returned; [test:returns fixed result] [test:missing assertion]; [test:missing]' });
  await client.comments(id, { add: 'closeout AC1: test="returns fixed result" file="source.ts"' });
  await client.comments(id, { add: 'closeout AC3: test="returns fixed result" file="unlinked.ts"' });
  const report = await reviewCloseout(client, id, options);
  assert.equal(report.criteria[0].verdict, 'proven');
  assert.equal(report.criteria[0].evidence[0].comment_id, 'comment:1');
  assert.equal(report.criteria[0].evidence[0].file, 'source.ts');
  assert.equal(report.criteria[1].verdict, 'unproven');
  assert.equal(report.criteria[2].verdict, 'unproven');
  assert.equal(report.ok, false);
});

test('failed and skipped named assertions cannot produce a successful criterion', async t => {
  const { client, id, options, cwd } = await closeoutFixture(t);
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('returns fixed result', () => assert.fail('contradiction')); test.skip('later', () => {});\n");
  const report = await reviewCloseout(client, id, { ...options, revertCheck: true });
  assert.equal(report.criteria[0].verdict, 'contradicted');
  assert.ok(report.findings.some(row => row.code === 'test_failed'));
  assert.ok(report.findings.some(row => row.code === 'test_skipped'));
  assert.equal(report.revert_check, 'inconclusive');
});

test('bare command success is absent named execution even when comments claim EXIT:0', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const item = (await client.create({ type: 'Task', title: 'An empty command', acceptanceCriteria: 'missing result' })).item;
  await client.run('test', { id: item.id, options: { add: [`command=${process.execPath} -e 'console.log("EXIT:0")'`] } });
  await client.comments(item.id, { add: 'EXIT:0' });
  const report = await reviewCloseout(client, item.id, { cwd, pmRoot });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(row => row.code === 'exit_claim_without_run'));
  assert.ok(report.findings.some(row => row.code === 'execution_missing'));
});

test('git-backed execution clones metadata, restores new and deleted source only in the copy', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  sourceFiles(cwd);
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['add', 'source.ts', 'case.test.ts'], { cwd });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline'], { cwd });
  mkdirSync(join(cwd, '.deps'));
  symlinkSync(join(cwd, '.deps'), join(cwd, 'node_modules'), 'dir');
  const item = (await client.create({ type: 'Task', title: 'Clone execution' })).item;
  // Historical path-only links are importable even though modern test mutations require commands.
  const located = await locateItem(pmRoot, item.id);
  const { document } = await readLocatedItem(located!);
  document.metadata.tests = [{ path: 'case.test.ts', scope: 'project' }];
  await commitImportedItem({ pmRoot, id: item.id, itemPath: located!.itemPath, document, author: 'test-agent', message: 'Import legacy test link', settings: await readSettings(pmRoot), conflictWarningPrefix: 'fixture' });
  const execution = await executeCloseout(client, item.id, { cwd, pmRoot, timeoutSeconds: 20 }, [
    { file: 'new.ts', before: null, after: 'new' },
    { file: 'nested/restored.ts', before: 'restored', after: null },
  ]);
  assert.equal(execution.error, '');
  assert.equal(execution.runs[0].status, 'skipped');
});


test('registered closeout success omits explicit zero exit and returns a compact test summary', async t => {
  const { id, options, cwd, pmRoot } = await closeoutFixture(t);
  const result = await runReviewCommand({ command: 'review closeout', args: [id], options: { timeout: String(options.timeoutSeconds) }, global: {}, pm_root: pmRoot, source_workspace_root: cwd }) as { ok: boolean; exit_code?: number; test_summary: { total: number; passed: number } };
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, 'exit_code'), false);
  assert.equal(result.test_summary.total, 1);
  assert.equal(result.test_summary.passed, 1);
});

test('deadline kills a detached linked-command descendant before discarding its workspace', async t => {
  const { cwd } = await tracker(t);
  const script = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached:true,stdio:'ignore'}); fs.writeFileSync('child.pid', String(child.pid)); setInterval(() => {}, 1000);`;
  const result = await boundedHost(['-e', script], cwd, 1000);
  assert.match(result.error, /budget exceeded/);
  const pid = Number(readFileSync(join(cwd, 'child.pid'), 'utf8'));
  // SIGKILL delivery and process reaping are asynchronous; observe bounded eventual termination.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if (/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail('detached descendant remained live after SIGKILL');
});


test('native counters from unrelated external modules cannot certify changed workspace functions', async t => {
  const { client, id, cwd, options } = await closeoutFixture(t);
  const external = await tracker(t);
  writeFileSync(join(external.cwd, 'outside.ts'), 'export function unrelated() { return 1; }');
  const externalUrl = pathToFileURL(join(external.cwd, 'outside.ts')).href;
  const original = readFileSync(join(cwd, 'case.test.ts'), 'utf8');
  writeFileSync(join(cwd, 'case.test.ts'), `import { unrelated } from ${JSON.stringify(externalUrl)}; unrelated();\n${original}`);
  assert.equal((await reviewCloseout(client, id, options)).ok, true);
});


test('a symlink workspace root cannot turn the disposable copy into writes to the original', async t => {
  const { client, id, cwd, options } = await closeoutFixture(t);
  const external = await tracker(t);
  const alias = join(external.cwd, 'workspace-alias');
  symlinkSync(cwd, alias, 'dir');
  const before = readFileSync(join(cwd, 'source.ts'), 'utf8');
  const report = await reviewCloseout(client, id, { ...options, cwd: alias });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(existsSync(join(cwd, '.closeout-pm')), false);
  assert.equal(readFileSync(join(cwd, 'source.ts'), 'utf8'), before);
});

test('a linked external artifact cannot enter an executable workspace snapshot', async t => {
  const { client, id, cwd, options } = await closeoutFixture(t);
  const external = await tracker(t);
  writeFileSync(join(external.cwd, 'foreign.txt'), 'original');
  symlinkSync(join(external.cwd, 'foreign.txt'), join(cwd, 'foreign-link'));
  const report = await reviewCloseout(client, id, options);
  assert.equal(report.ok, false);
  assert.equal(report.commands.length, 0);
  assert.ok(report.findings.some(row => row.code === 'execution_missing'));
  assert.equal(readFileSync(join(external.cwd, 'foreign.txt'), 'utf8'), 'original');
});

test('PM-managed extension dependency links preserve the pinned peer in the copied tracker', async t => {
  const { client, id, pmRoot, options } = await closeoutFixture(t);
  const dependency = join(pmRoot, 'extensions', 'fixture', 'node_modules', '@unbrained', 'pm-cli');
  mkdirSync(dirname(dependency), { recursive: true });
  symlinkSync(join(import.meta.dirname, '../node_modules/@unbrained/pm-cli'), dependency, 'dir');
  assert.equal((await reviewCloseout(client, id, options)).ok, true);
});

test('package-manager and tooling caches stay outside executable snapshots', async t => {
  const { client, id, cwd, options } = await closeoutFixture(t);
  for (const cache of ['.bun', '.npm', '.cache']) {
    const link = join(cwd, cache, 'install', 'cache', '@unbrained', 'pm-cli', '2026.10.18@@@1');
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(import.meta.dirname, '../node_modules/@unbrained/pm-cli'), link, 'dir');
  }
  const testPath = join(cwd, 'case.test.ts');
  writeFileSync(testPath, readFileSync(testPath, 'utf8') + "\nimport { existsSync } from 'node:fs'; test('volatile caches are absent', () => { for (const cache of ['.bun', '.npm', '.cache']) assert.equal(existsSync(cache), false); });\n");
  assert.equal((await reviewCloseout(client, id, options)).ok, true);
});
