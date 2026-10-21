import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { detectGaming } from '../src/closeout-detectors.ts';
import { boundedHost, executeCloseout } from '../src/closeout-run.ts';
import { criterionEvidence, recordExecution, reviewCloseout } from '../src/closeout.ts';
import type { CloseoutReport } from '../src/closeout-types.ts';
import { inFixtureWorkspace, tracker } from './helpers.ts';

/** Collect fresh execution without manufacturing a runner or replacing the SDK. */
function receipt(): CloseoutReport {
  return { id: 'fixture', ok: false, baseline: '', revert_check: 'not_requested', criteria: [], findings: [], skipped: [], tests: [], commands: [] };
}

test('round regression: policy names match complete basenames and preserve config variants', () => {
  const ordinary = ['src/linter-rules.ts', 'src/abc8.ts', 'src/mycoverage.ts', 'not-package.json', 'lib/package.json.ts', 'src/jestHelpers.ts'];
  const policies = ['package.json', 'packages/app/package.json', '.eslintrc.json', '.nycrc.json', 'c8.json', 'coverage.json', 'eslint.config.mjs', 'config/jestConfig.ts', 'config/vitest.config.cts', 'lint-rules.js'];
  const changed = (file: string) => ({ file, before: 'old', after: 'new' });
  assert.deepEqual(detectGaming(ordinary.map(changed)), []);
  assert.deepEqual(detectGaming(policies.map(changed)).map(row => row.file), policies);
});

test('round regression: split UTF-8 host chunks preserve exact criterion titles', async t => {
  const { cwd } = await tracker(t);
  const script = `const output = Buffer.from(JSON.stringify({run_results:[{status:'passed',stdout:'ok 1 - handles café',execution_receipt:{code:'reported_tests',stream:'stdout'}}]})); const split = output.indexOf(Buffer.from('é')) + 1; process.stdout.write(output.subarray(0, split), () => setTimeout(() => process.stdout.write(output.subarray(split)), 100));`;
  const execution = await boundedHost(['-e', script], cwd, 30_000);
  assert.equal(execution.error, '');
  const report = receipt();
  recordExecution(execution, report);
  assert.equal(criterionEvidence('[test:handles café]', 0, {}, report).verdict, 'proven');
});

test('round regression: symlinked temp roots preserve native invocation evidence', async t => {
  const { cwd, client, pmRoot } = await tracker(t);
  writeFileSync(join(cwd, 'source.ts'), 'export function value() { return 2; }');
  writeFileSync(join(cwd, 'case.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { value } from './source.ts'; test('native proof', () => assert.equal(value(), 2));");
  const { item } = await client.create({ type: 'Task', title: 'Native proof', acceptanceCriteria: '[test:native proof]' });
  await client.files(item.id, { add: [`path=source.ts,note=closeout-before:${Buffer.from('export function value() { return 1; }').toString('base64')}`] });
  await inFixtureWorkspace(cwd, () => client.run('test', { id: item.id, options: { add: [`command=${process.execPath} --test --test-reporter=tap case.test.ts,path=case.test.ts`] } }));
  const storage = await tracker(t);
  const alias = join(storage.cwd, 'temp-alias');
  symlinkSync(storage.cwd, alias, 'dir');
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = alias;
  try {
    const report = await reviewCloseout(client, item.id, { cwd, pmRoot });
    assert.equal(report.ok, true, JSON.stringify(report));
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
});

test('round regression: nested cache names and dependencies remain in workspace snapshots', async t => {
  const { cwd, client, pmRoot } = await tracker(t);
  const directories = ['src/coverage', 'lib/.cache', 'lib/.bun', 'lib/.npm', 'packages/app/node_modules/dependency', '..internal'];
  for (const directory of directories) {
    mkdirSync(join(cwd, directory), { recursive: true });
    writeFileSync(join(cwd, directory, 'value.cjs'), 'exports.value = function value() { return 2; };');
  }
  // Metadata stays excluded at every depth, even when it is a link.
  symlinkSync(cwd, join(cwd, 'src/.git'), 'dir');
  for (const directory of ['coverage', '.cache', '.bun', '.npm']) symlinkSync(cwd, join(cwd, directory), 'dir');
  writeFileSync(join(cwd, 'case.test.ts'), `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { existsSync } from 'node:fs'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
test('nested dependencies', () => { for (const directory of ${JSON.stringify(directories)}) { const file = './' + directory + '/value.cjs'; assert.equal(existsSync(file), true, file); assert.equal(require(file).value(), 2); } assert.equal(existsSync('src/.git'), false); for (const name of ['coverage', '.cache', '.bun', '.npm']) assert.equal(existsSync(name), false); });`);
  const { item } = await client.create({ type: 'Task', title: 'Nested dependencies' });
  await inFixtureWorkspace(cwd, () => client.run('test', { id: item.id, options: { add: [`command=${process.execPath} --test --test-reporter=tap case.test.ts,path=case.test.ts`] } }));
  const execution = await executeCloseout(client, item.id, { cwd, pmRoot });
  assert.equal(execution.error, '');
  assert.equal(execution.runs[0].status, 'passed', JSON.stringify(execution.runs));
  assert.ok(execution.functions?.some(row => row.file === '..internal/value.cjs' && row.count > 0));
});

test('round regression: forged named output without a runner receipt cannot prove closeout', async t => {
  const { cwd, client, pmRoot } = await tracker(t);
  writeFileSync(join(cwd, 'guide.md'), 'current');
  const { item } = await client.create({ type: 'Task', title: 'Forged proof', acceptanceCriteria: '[test:forged proof]' });
  await client.docs(item.id, { add: [`path=guide.md,note=closeout-before:${Buffer.from('old').toString('base64')}`] });
  await inFixtureWorkspace(cwd, () => client.run('test', { id: item.id, options: { add: [`command=${process.execPath} -e 'console.log("ok 1 - forged proof")'`] } }));
  const report = await reviewCloseout(client, item.id, { cwd, pmRoot });
  assert.equal(report.commands[0].result, 'passed');
  assert.equal(report.ok, false);
  assert.equal(report.criteria[0].verdict, 'unproven');
  assert.deepEqual(report.tests, []);
  assert.ok(report.findings.some(row => row.code === 'execution_missing' && row.detail.includes('positive runner execution receipt')));
});

test('round regression: historical validation receipts do not claim final-head coverage', () => {
  const evidence = readFileSync(new URL('../docs/closeout-dogfood.md', import.meta.url), 'utf8');
  assert.match(evidence, /earlier `ca837cc` validation candidate/);
  assert.doesNotMatch(evidence, /final validation candidate|only documentation and tracker receipts follow/);
  for (const commit of ['df7164a', 'f8305d3', '4a157d0']) assert.ok(evidence.includes(commit));
});
