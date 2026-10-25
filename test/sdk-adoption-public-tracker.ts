/** Compare built baseline and candidate review functions on a read-only public tracker export. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitAcceptanceCriteria } from '@unbrained/pm-cli/sdk';
import type { CoverageMap, CoverageResult } from '../src/coverage-types.ts';

const [pmRoot, beforeBuild, afterBuild] = process.argv.slice(2).map(path => resolve(path));
assert.ok(pmRoot && beforeBuild && afterBuild, 'Pass a public tracker export and baseline/candidate build roots');
/** Enumerate exported durable files while excluding disposable SDK read state. */
async function durableFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (['runtime', 'locks', 'search', 'transactions', 'extensions'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await durableFiles(path));
    else result.push(path);
  }
  return result.sort();
}
/** Hash the exact exported input set to detect any durable mutation. */
async function fingerprint(files: string[]): Promise<string> {
  const chunks = await Promise.all(files.map(file => readFile(file)));
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}
/** Run static imports of each real build in an independent SDK process without git discovery. */
function observe(build: string): { id: string; contract: string; coverage: CoverageResult; cover: CoverageResult; scope: [string, string][]; closeout: unknown }[] {
  const source = `
import { PmClient } from ${JSON.stringify(pathToFileURL(resolve('node_modules/@unbrained/pm-cli/dist/sdk/index.js')).href)};
import { reviewCoverage, coverCriterion } from ${JSON.stringify(pathToFileURL(join(build, 'src/coverage.js')).href)};
import { scopeCriteria } from ${JSON.stringify(pathToFileURL(join(build, 'src/scope-state.js')).href)};
import { reviewCloseout } from ${JSON.stringify(pathToFileURL(join(build, 'src/closeout.js')).href)};
const pmRoot = process.argv[1];
const client = new PmClient({ cwd: process.argv[2], pmRoot, noExtensions: true, author: 'public-validation' });
const items = (await client.listAllComplete()).items;
const rows = [];
let closeoutCount = 0;
for (const item of items) {
  const coverage = await reviewCoverage(client, item.id);
  const cover = await coverCriterion(client, item.id, { revision: 'deliberately-invalid-revision', criterion: 'AC1', evidence: item.id, judgment: 'reviewed', excerpt: 'Read-only differential validation', reason: 'Invalid revision prevents all writes' });
  let closeout = { not_sampled: true };
  if (closeoutCount < 3 && item.acceptance_criteria) {
    closeoutCount++;
    try { closeout = await reviewCloseout(client, item.id, { cwd: process.argv[2], pmRoot, timeoutSeconds: 10 }); }
    catch (error) { closeout = { error: error instanceof Error ? error.message : String(error) }; }
  }
  rows.push({ closeout, id: item.id, contract: item.acceptance_criteria ?? '', coverage, cover, scope: [...scopeCriteria(item)] });
}
console.log(JSON.stringify(rows));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, pmRoot, dirname(dirname(pmRoot))], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PATH: '', GIT_CEILING_DIRECTORIES: dirname(dirname(dirname(pmRoot))) },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
const files = await durableFiles(pmRoot);
for (const file of files) await chmod(file, 0o444);
const initial = await fingerprint(files);
const before = observe(beforeBuild);
assert.deepEqual(await durableFiles(pmRoot), files, 'Durable input file set changed');
assert.equal(await fingerprint(files), initial);
const after = observe(afterBuild);
assert.deepEqual(await durableFiles(pmRoot), files, 'Durable input file set changed');
assert.equal(await fingerprint(files), initial);
assert.equal(after.length, before.length);
const differences: { id: string; before: string[]; after: string[]; revision_versioned: boolean }[] = [];
for (let index = 0; index < before.length; index++) {
  const old = before[index];
  const current = after[index];
  assert.equal(current.id, old.id);
  assert.deepEqual(current.cover, old.cover);
  assert.deepEqual(current.closeout, old.closeout);
  const texts = splitAcceptanceCriteria(old.contract);
  if (!old.coverage.ok || !current.coverage.ok) { assert.deepEqual(current, old); continue; }
  assert.equal(old.coverage.judgments.length, 0, 'Mapped exports need an explicit refusal-by-refusal migration assertion');
  const expected: CoverageMap = {
    ...old.coverage,
    revision: createHash('sha256').update(JSON.stringify(old.contract.includes('\n') ? ['review-criteria/v2', old.contract] : old.contract)).digest('hex'),
    total: texts.length, reviewed: 0, unreviewed: texts.length,
    criteria: texts.map((text, criterion) => ({ id: `AC${criterion + 1}`, text, state: 'unreviewed' })),
  };
  assert.deepEqual(current.coverage, expected);
  assert.deepEqual(current.scope, texts.map((text, criterion) => [`AC${criterion + 1}`, createHash('sha256').update(JSON.stringify(text)).digest('hex')]));
  if (JSON.stringify(old) !== JSON.stringify(current)) differences.push({ id: old.id, before: old.coverage.criteria.map(row => row.text), after: texts, revision_versioned: current.coverage.revision !== old.coverage.revision });
}
console.log(JSON.stringify({ items: after.length, function_comparisons: after.length * 3 + after.filter(row => !('not_sampled' in (row.closeout as Record<string, unknown>))).length, closeout_reports: after.filter(row => 'criteria' in (row.closeout as Record<string, unknown>)).length, closeout_refusals: after.filter(row => 'error' in (row.closeout as Record<string, unknown>)).length, identical_items: after.length - differences.length, intentional_multiline_differences: differences, durable_files_unchanged: files.length, git_available: false }, null, 2));
