import '../src/coverage-types.ts';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk, commitImportedItem, locateItem, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import type { TestContext } from 'node:test';
import { coverCriterion, reviewCoverage } from '../src/coverage.ts';
import type { CoverOptions, CoverageCode, CoverageMap, CoverageResult } from '../src/coverage-types.ts';
import { runReviewCommand } from '../src/commands.ts';
import { fieldOptions, importFindings } from '../src/tracker.ts';
import { findingsOf } from '../src/findings.ts';
import { contribution, pullRequest, tracker, inFixtureWorkspace } from './helpers.ts';

/** Construct real source and criterion contracts in an isolated non-git tracker. */
async function fixture(t: TestContext) {
  const base = await tracker(t);
  const pr = pullRequest({ reviews: [], comments: [] });
  const imported = await importFindings(base.client, pr, findingsOf(pr));
  const target = (await base.client.create({ type: 'Task', title: 'Validation boundaries', acceptanceCriteria: 'Reject invalid input; Preserve valid values' })).item;
  const map = await reviewCoverage(base.client, target.id) as CoverageMap;
  const options: CoverOptions = { revision: map.revision, criterion: 'AC1', evidence: imported.items[0].id, judgment: 'reviewed', excerpt: 'Validate the input before writing.', reason: 'Reviews the invalid input boundary' };
  return { ...base, id: target.id, options };
}

/** Assert stable refusal vocabulary instead of matching presentation strings. */
function denied(result: CoverageResult, code: CoverageCode): void {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('expected refusal');
  assert.equal(result.refusal.code, code);
  assert.ok(result.refusal.remedy.length > 20);
}


/** Notice phrases are tested as topics and as explicit provider declarations. */
const COVERAGE_NOTICES = [
  'Quota exceeded', 'Quota exhausted', 'Rate-limited', 'Rate limit exceeded', 'Rate-limit reached',
  'Review skipped', 'Skipped review', 'Review failed', 'Review unavailable',
  'Review was not performed', 'Review is not completed', 'Review cancelled', 'Review canceled',
  'Trial ended', 'Trial has ended', 'Review budget', 'No access', 'No access to this repository',
  'No access to reviews', 'Failed to review', 'Failed to generate',
];

/** Re-import one real source so classifier state and content digests are exercised without growing the inventory. */
async function checkCoverageCases(t: TestContext, cases: { body: string; allowed: boolean }[]): Promise<void> {
  const { client, pmRoot, id, options } = await fixture(t);
  const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  for (const scenario of cases) {
    const pr = pullRequest({ threads: [{ id: 'classification-source', path: 'src/counter.ts', line: 1, resolved: false, comments: [contribution({ body: scenario.body })] }], comments: [], reviews: [] });
    const imported = await importFindings(client, pr, findingsOf(pr));
    const binding = { ...options, evidence: imported.items[0].id };
    const sdk = await coverCriterion(client, id, binding);
    const command = await runRegisteredCommandForTest(activation.commands, { command: 'review cover', args: [id], options: binding, pmRoot, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') });
    assert.equal(command.handled, true);
    assert.equal(sdk.ok, scenario.allowed, scenario.body);
    if (scenario.allowed) {
      assert.equal((sdk as CoverageMap).reviewed, 1, scenario.body);
      assert.equal((command.result as CoverageMap).reviewed, 1, scenario.body);
    } else {
      denied(sdk, 'evidence_ineligible');
      denied(command.result as CoverageResult, 'evidence_ineligible');
      assert.equal((command.result as { exit_code: number }).exit_code, 1);
    }
  }
  const accepted = cases.filter(scenario => scenario.allowed).length;
  t.diagnostic(`${cases.length} classification scenarios: ${accepted} accepted, ${cases.length - accepted} refused through SDK and registered CLI`);
}

test('explicit coverage is attributed, compact, read-only, and supports retracted and competing judgments', async t => {
  const { client, id, options } = await fixture(t);
  await client.comments(id, { add: 'All checks are green; this is not a mapping.' });
  assert.equal((await reviewCoverage(client, id) as CoverageMap).reviewed, 0);
  const result = await coverCriterion(client, id, options) as CoverageMap;
  assert.equal(result.reviewed, 1);
  assert.equal(result.unreviewed, 1);
  assert.deepEqual(result.criteria.map(row => row.state), ['reviewed', 'unreviewed']);
  assert.equal(result.judgments[0].author, 'test-agent');
  assert.equal(result.judgments[0].reviewer, 'coderabbitai[bot]');
  assert.equal(result.judgments[0].comment, 2);
  assert.match(result.judgments[0].date, /^\d{4}-/);
  assert.match(result.judgments[0].url, /github.com/);
  assert.equal(result.judgments[0].head, 'a'.repeat(40));
  assert.ok(!JSON.stringify(result).includes('excerpt'));
  const before = JSON.stringify((await client.get(id, { full: true })).item);
  await reviewCoverage(client, id);
  assert.equal(JSON.stringify((await client.get(id, { full: true })).item), before);
  await coverCriterion(client, id, options);
  assert.equal((await reviewCoverage(client, id) as CoverageMap).judgments.length, 2);
  const gap = await coverCriterion(client, id, { ...options, judgment: 'gap', reason: 'Input length bounds remain unreviewed' }) as CoverageMap;
  assert.equal(gap.criteria[0].state, 'gap');
  const recovered = await coverCriterion(client, id, options) as CoverageMap;
  assert.equal(recovered.reviewed, 1);
  await coverCriterion(client, id, { ...options, criterion: 'AC2' });
  assert.equal((await reviewCoverage(client, id) as CoverageMap).unreviewed, 0);
});

test('changed criteria, reordered criteria and changed source content invalidate mappings', async t => {
  const { client, id, options } = await fixture(t);
  await coverCriterion(client, id, options);
  await client.update(id, { acceptanceCriteria: 'Preserve valid values; Reject invalid input' });
  const changed = await reviewCoverage(client, id) as CoverageMap;
  assert.equal(changed.reviewed, 0);
  assert.equal(changed.judgments[0].refusal?.code, 'criteria_changed');
  denied(await coverCriterion(client, id, options), 'criteria_changed');
  const newOptions = { ...options, revision: changed.revision };
  await coverCriterion(client, id, newOptions);
  await client.update(options.evidence, { description: 'Validate the input before writing. Revised review context.' });
  const source = await reviewCoverage(client, id) as CoverageMap;
  assert.equal(source.reviewed, 0);
  assert.equal(source.judgments[1].refusal?.code, 'evidence_changed');
  await coverCriterion(client, id, newOptions);
  assert.equal((await reviewCoverage(client, id) as CoverageMap).reviewed, 1);
});

test('quota and skipped notices cover zero even with severity markers or forged mappings', async t => {
  const { client, id, options } = await fixture(t);
  for (const body of ['Quota exhausted. **High** Validate the input before writing.', 'Review skipped. Validate the input before writing.', 'Review unavailable. Validate the input before writing.', 'rate-limit reached. Validate the input before writing.', 'Review was not performed. Validate the input before writing.', 'Summary by CodeRabbit', '']) {
    await client.update(options.evidence, { description: body });
    denied(await coverCriterion(client, id, options), 'evidence_ineligible');
  }
  assert.equal((await reviewCoverage(client, id) as CoverageMap).reviewed, 0);
});

test('invalid selectors and judgments return typed remedies without writes', async t => {
  const { client, id, options } = await fixture(t);
  denied(await coverCriterion(client, id, { ...options, criterion: 'AC99' }), 'criterion_unknown');
  denied(await coverCriterion(client, id, { ...options, evidence: 'absent' }), 'evidence_missing');
  for (const invalid of [{ judgment: 'pass' }, { reason: 'short' }, { reason: 'x'.repeat(1001) }, { excerpt: 'short' }, { excerpt: 'x'.repeat(1001) }, { excerpt: 'A long quote absent from the source review' }, { criterion: 2 }]) {
    denied(await coverCriterion(client, id, { ...options, ...invalid } as CoverOptions), 'judgment_invalid');
  }
  assert.equal((await reviewCoverage(client, id) as CoverageMap).judgments.length, 0);
  await client.update(id, { acceptanceCriteria: '' });
  denied(await reviewCoverage(client, id), 'criteria_missing');
  denied(await coverCriterion(client, id, options), 'criteria_missing');
  await assert.rejects(reviewCoverage(client, 'absent'), /not found/i);
});

test('malformed imported comment bindings remain visible and never count', async t => {
  const { client, id, options } = await fixture(t);
  for (const value of ['broken', 'null', '1', '{}', '{"revision":1}', JSON.stringify({ ...options, digest: 'hash', judgment: 'pass' })]) await client.comments(id, { add: 'review-coverage/v1 ' + value });
  const result = await reviewCoverage(client, id) as CoverageMap;
  assert.equal(result.judgments.length, 6);
  assert.ok(result.judgments.every(row => row.refusal?.code === 'mapping_invalid'));
  assert.equal(result.reviewed, 0);
});

test('incomplete or unbound provenance cannot establish coverage', async t => {
  const { client, id, options } = await fixture(t);
  const original = (await client.get(options.evidence, { full: true })).item;
  const updates: Record<string, string | number | boolean>[] = [
    { reviewBot: '' }, { reviewNodeId: '' }, { reviewRepo: 'bad' }, { reviewPr: 0 },
    { reviewUrl: 'https://example.invalid/review' }, { reviewHead: '' },
  ];
  for (const update of updates) {
    await client.update(options.evidence, { ...fieldOptions(Object.fromEntries(Object.entries(original).filter(([key]) => key.startsWith('review_'))) as Record<string, string | number | boolean>), ...update });
    denied(await coverCriterion(client, id, options), 'evidence_ineligible');
  }
  const task = (await client.create({ type: 'Task', title: 'Not a source' })).item;
  denied(await coverCriterion(client, id, { ...options, evidence: task.id }), 'evidence_ineligible');
});

test('coverage dispatch works without git in PATH, with a ceiling, and returns typed nonzero refusals', async t => {
  const { client, id, cwd, pmRoot, options } = await fixture(t);
  const bin = join(cwd, 'empty-bin');
  mkdirSync(bin);
  const oldPath = process.env.PATH;
  const oldCeiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.PATH = bin;
  process.env.GIT_CEILING_DIRECTORIES = dirname(cwd);
  try {
    const ctx = { command: 'review coverage', args: [id], options: {}, global: { author: 'test-agent' }, pm_root: pmRoot, repo_root: cwd };
    assert.equal((await runReviewCommand(ctx) as CoverageMap).reviewed, 0);
    assert.equal((await runReviewCommand({ ...ctx, global: {} }) as CoverageMap).reviewed, 0);
    const covered = await runReviewCommand({ ...ctx, command: 'review cover', options: { ...options } }) as CoverageMap;
    assert.equal(covered.reviewed, 1);
    const deniedResult = await runReviewCommand({ ...ctx, command: 'review cover' }) as { exit_code: number; refusal: { code: string } };
    assert.equal(deniedResult.exit_code, 1);
    assert.equal(deniedResult.refusal.code, 'judgment_invalid');
    await assert.rejects(runReviewCommand({ ...ctx, args: [] }), /id|item|not found/i);
    await client.update(id, { acceptanceCriteria: '' });
    assert.equal((await runReviewCommand(ctx) as { exit_code: number }).exit_code, 1);
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    if (oldCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = oldCeiling;
  }
});

test('a gap from another source dominates reviewed claims', async t => {
  const { client, id, options } = await fixture(t);
  const pr = pullRequest({ threads: [], comments: [], reviews: [{ ...contribution({ id: 'second-review', body: 'Validate the input before writing.' }), state: 'COMMENTED' }] });
  const imported = await importFindings(client, pr, findingsOf(pr));
  await coverCriterion(client, id, options);
  const result = await coverCriterion(client, id, { ...options, evidence: imported.items[0].id, judgment: 'gap', author: 'gap-review-agent' }) as CoverageMap;
  assert.equal(result.criteria[0].state, 'gap');
  assert.equal(result.judgments.at(-1)!.author, 'gap-review-agent');
});


test('missing source mappings refuse and imported attribution is normalized by the SDK', async t => {
  const { client, cwd, pmRoot, id, options } = await fixture(t);
  await coverCriterion(client, id, options);
  const comment = (await client.get(id, { full: true })).item.comments![0];
  const binding = JSON.parse(comment.text.slice('review-coverage/v1 '.length));
  await client.comments(id, { add: 'review-coverage/v1 ' + JSON.stringify({ ...binding, evidence: 'absent' }) });
  let result = await reviewCoverage(client, id) as CoverageMap;
  assert.equal(result.judgments[1].refusal?.code, 'evidence_missing');
  assert.equal(result.judgments[1].reviewer, '');
  const located = await locateItem(pmRoot, id);
  const { document } = await readLocatedItem(located!);
  document.metadata.comments!.push({ ...comment, author: '' }, { ...comment, created_at: '' });
  await inFixtureWorkspace(cwd, async () => commitImportedItem({ pmRoot, id, itemPath: located!.itemPath, document, author: 'test-agent', message: 'Import incomplete attribution fixture', settings: await readSettings(pmRoot), conflictWarningPrefix: 'fixture' }));
  result = await reviewCoverage(client, id) as CoverageMap;
  assert.ok(result.judgments[2].refusal || result.judgments[2].author.trim().length > 0);
  assert.ok(result.judgments[3].refusal || result.judgments[3].date.trim().length > 0);
});


test('substantive quota and rate-limit findings remain eligible through SDK and registered commands', async t => {
  const cases = [
    ...['allowance', 'quota', 'rate-limit'].map(topic => ({ body: `**High** Validate the input before writing. The ${topic} counter must be atomic.`, allowed: true })),
    ...COVERAGE_NOTICES.map(notice => ({ body: `**Major** The ${notice.toLowerCase()} error leaks an account identifier. Validate the input before writing.`, allowed: true })),
    ...['Quota exceeded errors leak an identifier', 'Rate-limit reached handling loses requests', 'No access checks protect the operation', 'Failed to generate errors expose a private value'].map(finding => ({ body: `**Major** ${finding}. Validate the input before writing.`, allowed: true })),
    ...COVERAGE_NOTICES.map(notice => ({ body: `**High** ${notice}. Validate the input before writing.`, allowed: false })),
    ...[
      'Quota exhausted. **High** Validate the input before writing.',
      '**High**\n> Quota exhausted.\nValidate the input before writing.',
      '**High**\r\n## Review unavailable!\r\nValidate the input before writing.',
      '> ## **High** Rate-limit reached! Validate the input before writing.',
      '- **High** No access to this repository? Validate the input before writing.',
      '**Quota exhausted.** **High** Validate the input before writing.',
      '**High** Validate the input before writing.\nReview failed\nReview details follow.',
      '_🟠 Major_ Review unavailable. Validate the input before writing.',
      'severity: high No access. Validate the input before writing.',
      '![high-priority](https://example.invalid/severity.svg) Review failed. Validate the input before writing.',
      '![low_priority] Quota exhausted. Validate the input before writing.',
    ].map(body => ({ body, allowed: false })),
  ];
  await checkCoverageCases(t, cases);
});


test('unmarked substantive findings stay eligible while explicit summaries and service notices do not', async t => {
  const providerNotices = [
    'Action not completed', "You've used your own review budget for today",
    'Your pull request is larger than the review limit', 'Your private repo does not have access',
    '101 files exceed the limit of 100', 'You do not have access to this repository',
    "You don't have access to reviews", 'This repository does not receive automatic reviews',
    'You are seeing this message because GitHub Code Scanning has recently been set up',
    'This pull request contains the workflow file for the Code Scanning tool',
    'Sorry reviewer, your private repo does not have access',
    'Your private repo does not have access to automatic reviews',
    "You've used your own review budget until tomorrow",
    'Your pull request is larger than the review limit and was not reviewed',
    '101 files exceed the limit of 100, so the review was skipped',
    'This repository does not receive automatic reviews under this plan',
  ];
  const cases = [
    ...COVERAGE_NOTICES.map(notice => ({ body: `The ${notice.toLowerCase()} error leaks an account identifier. Validate the input before writing.`, allowed: true })),
    ...[
      'The rate-limit counter must be atomic to prevent lost updates.',
      'Quota exceeded errors leak an identifier.', 'Rate-limit reached handling loses requests.',
      'No access checks protect the operation.', 'Failed to generate errors expose a private value.',
      'The walkthrough omits input validation.', 'The summary of changes hides a missing guard.',
    ].map(finding => ({ body: `${finding} Validate the input before writing.`, allowed: true })),
    ...COVERAGE_NOTICES.map(notice => ({ body: `${notice}. Validate the input before writing.`, allowed: false })),
    ...providerNotices.map(notice => ({ body: `The ${notice.toLowerCase()} message handler loses valid input. Validate the input before writing.`, allowed: true })),
    ...providerNotices.flatMap(notice => ['', '**High** '].map(prefix => ({ body: `${prefix}${notice}. Validate the input before writing.`, allowed: false }))),
    ...[
      'Summary by CodeRabbit', 'Walkthrough', 'No actionable issues', 'No actionable comments',
      'Actionable comments posted: 0', 'Summary of changes', 'Summary of pull request',
      'Full review finished', "Reviewer's guide", '✅ Action performed',
    ].map(heading => ({ body: `**${heading}**
Validate the input before writing.`, allowed: false })),
    { body: '<details><summary>✅ Action performed</summary>\nValidate the input before writing.</details>', allowed: false },
    { body: '**Summary by CodeRabbit**\n**Major** Validate the input before writing.', allowed: true },
    { body: '**Summary by CodeRabbit**\nActionable comments posted: 1\nValidate the input before writing.', allowed: true },
  ];
  await checkCoverageCases(t, cases);
});
