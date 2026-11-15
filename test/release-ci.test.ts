/** Preserve required PR contexts and exhaustive release contracts across CI tiers. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseDocument } from 'yaml';
import { testDepth } from './support/depth.ts';
import { testTime } from './support/time.ts';

/** Parse real workflow files strictly, including duplicate-key validation. */
function workflow(name: string) {
  const doc = parseDocument(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'), { uniqueKeys: true });
  assert.deepEqual(doc.errors, []);
  return doc.toJS();
}

test('PR gates preserve required names, bounded execution and the cheap docs path', () => {
  const ci = workflow('ci');
  assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'workflow_dispatch']);
  assert.deepEqual(Object.keys(ci.jobs), ['test']);
  assert.deepEqual(ci.jobs.test.strategy.matrix['node-version'], [22, 26]);
  assert.equal(ci.jobs.test['runs-on'], 'ubuntu-latest');
  assert.equal(ci.jobs.test.env.PM_TEST_DEPTH, 'quick');
  assert.ok(ci.jobs.test['timeout-minutes'] > 0 && ci.jobs.test['timeout-minutes'] <= 30);
  assert.match(ci.concurrency['cancel-in-progress'], /pull_request/);
  const steps = ci.jobs.test.steps;
  const gate = steps.find((step: { run?: string }) => step.run === 'npm run release:check');
  assert.match(gate.if, /code == 'true'.*== 26/);
  assert.ok(!steps.some((step: { run?: string }) => step.run === 'bun run release:check'));
  assert.match(steps.find((step: { run?: string }) => step.run === 'npm test').if, /== 22/);
  const cheap = steps.filter((step: { if?: string; run?: string }) => step.run && (!step.if || step.if.includes("code != 'true'")));
  assert.ok(cheap.some((step: { run: string }) => step.run.includes('npm ci')));
  assert.ok(cheap.some((step: { run: string }) => step.run.includes('health --strict-exit --require-merge-drivers')));
  assert.ok(cheap.some((step: { run: string }) => step.run === 'npm run changelog:check'));
});

test('deep tier retains both full release gates on both engines and avoids local WAN setup', () => {
  const ci = workflow('ci-deep');
  assert.deepEqual(Object.keys(ci.on).sort(), ['push', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(ci.on.push.branches, ['main']);
  const job = ci.jobs.deep;
  assert.deepEqual(job.strategy.matrix['node-version'], [22, 26]);
  assert.deepEqual(job.env, { PM_TEST_DEPTH: 'full', PM_TEST_TIME_SCALE: 3 });
  assert.equal(job['timeout-minutes'], 120);
  assert.match(job['runs-on'], /PM_LOCAL_DEEP != 'off'.*self-hosted.*pm-local.*ubuntu-latest/);
  for (const run of ['npm run release:check', 'bun run release:check', 'bun --version', 'bun install --no-save']) {
    assert.ok(job.steps.some((step: { run?: string; if?: string }) => step.run === run && !step.if));
  }
  const node = job.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(node.with.cache, "${{ runner.environment == 'github-hosted' && 'npm' || '' }}");
  const bun = job.steps.find((step: { uses?: string }) => step.uses?.startsWith('oven-sh/setup-bun@'));
  assert.equal(bun.if, "runner.environment == 'github-hosted'");
  const codeql = workflow('codeql');
  assert.equal(codeql.on.push['paths-ignore'], undefined);
  assert.equal(codeql.on.pull_request['paths-ignore'], undefined);
  assert.equal(codeql.jobs.codeql['timeout-minutes'], 30);
  assert.equal(codeql.on.schedule[0].cron, '47 1 * * 1');
});

test('depth defaults to full and watchdog scaling rejects unbounded values', () => {
  const depth = process.env.PM_TEST_DEPTH;
  const scale = process.env.PM_TEST_TIME_SCALE;
  try {
    delete process.env.PM_TEST_DEPTH;
    assert.equal(testDepth(500), 500);
    process.env.PM_TEST_DEPTH = 'quick';
    assert.equal(testDepth(500), 50);
    assert.equal(testDepth(600), 60);
    assert.equal(testDepth(100), 25);
    assert.equal(testDepth(20), 20);
    process.env.PM_TEST_DEPTH = 'unknown';
    assert.equal(testDepth(500), 500);
    delete process.env.PM_TEST_TIME_SCALE;
    assert.equal(testTime(1000), 1000);
    process.env.PM_TEST_TIME_SCALE = '3';
    assert.equal(testTime(1000), 3000);
    for (const invalid of ['0', '-1', 'NaN', 'Infinity', '0.0001', '']) {
      process.env.PM_TEST_TIME_SCALE = invalid;
      assert.throws(() => testTime(1000), /PM_TEST_TIME_SCALE/);
    }
  } finally {
    if (depth === undefined) delete process.env.PM_TEST_DEPTH;
    else process.env.PM_TEST_DEPTH = depth;
    if (scale === undefined) delete process.env.PM_TEST_TIME_SCALE;
    else process.env.PM_TEST_TIME_SCALE = scale;
  }
});
