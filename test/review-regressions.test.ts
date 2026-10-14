import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { runReviewCommand } from '../src/commands.ts';
import { findingsOf, isInformational, isReviewNotice, severityOf } from '../src/findings.ts';
import { ensureReviewSchema, fieldOptions, findReviewItems, importFindings, reviewItems } from '../src/tracker.ts';
import { evaluateRound } from '../src/round.ts';
import { decide } from '../src/verdict.ts';
import { contribution, pullRequest, syntheticTransport, tracker } from './helpers.ts';

test('repository-only precedent filters work independently and still validate coordinates', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  for (const [index, repo, number] of [[0, 'example/package', 1], [1, 'example/package', 2], [2, 'other/package', 1]] as const) {
    const pr = pullRequest({ repo, number, reviews: [], comments: [] });
    pr.threads[0].id = `precedent-${index}`;
    const imported = await importFindings(client, pr, findingsOf(pr));
    await decide(client, undefined, { id: imported.items[0].id, repo, pr: number, verdict: 'fix', reason: 'Input validation precedents', commit: '', apply: false });
  }
  const ctx: CommandHandlerContext = { command: 'review precedents', args: ['validation'], options: {}, global: { json: true }, pm_root: pmRoot, repo_root: cwd, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') };
  for (const [options, count] of [[{ repo: 'example/package' }, 2], [{ pr: '1' }, 2], [{ repo: 'example/package', pr: '1' }, 1], [{}, 3]] as const) {
    assert.equal((await runReviewCommand({ ...ctx, options }) as { count: number }).count, count);
  }
  for (const options of [{ repo: 'invalid' }, { pr: '0' }, { pr: '1.5' }, { pr: '9999999999999999999' }]) {
    await assert.rejects(runReviewCommand({ ...ctx, options }), /owner\/name|positive/);
  }
  for (const command of ['review import', 'review round', 'review verdict']) {
    await assert.rejects(runReviewCommand({ ...ctx, command, options: { repo: 'example/package' } }), /positive/);
  }
});

test('bold severity badges keep quoted completion notices actionable through import', async t => {
  const { client } = await tracker(t);
  for (const badge of ['**🟠 Major**', '**🟡 Minor**', '**🔴 Critical**', '**High**']) {
    const body = `**Functional Correctness** | ${badge}\n\nReject an unreviewed head even when a reply says “Full review finished”.`;
    assert.equal(isInformational(body), false);
    const pr = pullRequest({ reviews: [], comments: [] });
    pr.threads[0].id = badge;
    pr.threads[0].comments[0].body = body;
    const imported = await importFindings(client, pr, findingsOf(pr));
    assert.equal(imported.items[0].verdict, 'pending');
    assert.deepEqual(evaluateRound(pr, await reviewItems(client)).pending_items, [imported.items[0].id]);
  }
});

test('provider limit and setup notices stay informational without swallowing substantive findings', async t => {
  const { client } = await tracker(t);
  // Provider notice wording from the reviewed PR and supplied fleet examples; mentions use a synthetic actor.
  const notices = [
    "Sorry @maintainer, you've used your own review budget of 250,000 diff characters for the last 7 days.",
    'Sorry @maintainer, your pull request is larger than the review limit of 150,000 diff characters',
    'Sorry @maintainer, your private repo does not have access to Sourcery reviews.',
    'Your trial has ended. [Reactivate Greptile](https://app.greptile.com/-/pull-requests) to resume code reviews.',
    'This repository does not receive automatic reviews because it has fewer than 10 stars.',
    'Review skipped: 115 files exceed the limit of 100.',
    '115 files exceed the limit of 100.',
    'Review skipped',
    'You are seeing this message because GitHub Code Scanning has recently been set up for this repository, or this pull request contains the workflow file for the Code Scanning tool.',
    'This pull request contains the workflow file for the Code Scanning tool.',
  ];
  const pr = pullRequest({ threads: [], reviews: [], comments: notices.map((body, index) => contribution({ id: `notice-${index}`, body })) });
  assert.ok(notices.every(isInformational));
  const imported = await importFindings(client, pr, findingsOf(pr));
  assert.ok(imported.items.every(item => item.verdict === 'informational'));
  assert.deepEqual(evaluateRound(pr, await reviewItems(client)).pending_items, []);
  for (const body of ['Fix the review limit validation.', 'Validate the Code Scanning workflow before enabling it.', 'Private repo access must be verified before writes.', 'Reject a pull request larger than the review limit instead of truncating it.', 'Handle errors when files exceed the limit of 100.', 'Fix review budget accounting.', 'Validate whether this pull request contains the workflow file for the Code Scanning tool.']) assert.equal(isInformational(body), false);
  for (const notice of notices) assert.equal(isInformational(`**🟠 Major**\nFix notice handling: ${notice}`), false);
});

test('re-import reclassifies automatic verdicts and preserves explicit and legacy local decisions', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest({ reviews: [], comments: [] });
  pr.threads[0].comments[0].body = 'Walkthrough';
  const first = await importFindings(client, pr, findingsOf(pr));
  const id = first.items[0].id;
  pr.threads[0].comments[0].body = 'Validate the input before writing.';
  const actionable = await importFindings(client, pr, findingsOf(pr));
  assert.equal(actionable.items[0].verdict, 'pending');
  assert.equal((await client.get(id)).item.review_verdict_source, 'import');
  assert.deepEqual(evaluateRound(pr, await reviewItems(client)).pending_items, [id]);
  pr.threads[0].comments[0].body = 'Walkthrough';
  assert.equal((await importFindings(client, pr, findingsOf(pr))).items[0].verdict, 'informational');
  await decide(client, undefined, { id, repo: pr.repo, pr: pr.number, verdict: 'informational', reason: 'Explicit local decision', commit: '', apply: false });
  pr.threads[0].comments[0].body = 'Validate changed input.';
  assert.equal((await importFindings(client, pr, findingsOf(pr))).items[0].verdict, 'informational');
  assert.equal((await client.get(id)).item.review_verdict_source, 'local');
  assert.equal((await client.comments(id)).comments.length, 1);
  await ensureReviewSchema(client);
  const cases = [
    { verdict: 'informational', reason: '', commit: '', source: '', expected: 'pending' },
    { verdict: 'pending', reason: '', commit: '', source: '', expected: 'pending' },
    { verdict: 'informational', reason: 'Legacy explicit reasoning', commit: '', source: '', expected: 'informational' },
    { verdict: 'informational', reason: '', commit: 'b'.repeat(40), source: '', expected: 'informational' },
    { verdict: 'fix', reason: '', commit: '', source: '', expected: 'fix' },
    { verdict: 'informational', reason: '', commit: '', source: 'local', expected: 'informational' },
  ];
  for (const [index, scenario] of cases.entries()) {
    const node = `legacy-${index}`;
    const prior = await client.create({ id: node, type: 'ReviewFinding', title: 'Legacy review context', ...fieldOptions({ review_node_id: node, review_verdict: scenario.verdict, review_reason: scenario.reason, review_commit: scenario.commit, ...(scenario.source ? { review_verdict_source: scenario.source } : {}) }) });
    pr.threads[0].id = node;
    const imported = await importFindings(client, pr, findingsOf(pr));
    assert.equal(imported.items[0].id, prior.item.id);
    assert.equal(imported.items[0].verdict, scenario.expected);
    assert.equal((await client.get(prior.item.id)).item.review_verdict_source, scenario.expected === 'pending' ? 'import' : 'local');
    assert.equal(evaluateRound(pr, await reviewItems(client)).pending_items.includes(prior.item.id), scenario.expected === 'pending');
  }
});

test('duplicate and stale first apply vote and retries satisfy the round voting gate', async t => {
  const { client } = await tracker(t);
  for (const verdict of ['duplicate', 'stale'] as const) {
    const pr = pullRequest({ reviews: [], comments: [] });
    pr.threads[0].id = verdict;
    pr.threads[0].comments[0].reactions = [];
    const transport = syntheticTransport(pr);
    const imported = await importFindings(client, pr, findingsOf(pr));
    const input = { id: imported.items[0].id, repo: pr.repo, pr: pr.number, verdict, reason: 'Existing work already accounts for this finding.', commit: '', apply: true };
    assert.equal(evaluateRound(pr, await reviewItems(client)).unvoted_bot_comments.length, 1);
    assert.equal((await decide(client, transport, input)).reacted, true);
    assert.deepEqual(transport.calls, ['reply', 'THUMBS_UP', 'resolve']);
    assert.deepEqual(evaluateRound(pr, await reviewItems(client)).unvoted_bot_comments, []);
    assert.deepEqual(evaluateRound(pr, await reviewItems(client)).pending_items, []);
    const retry = await decide(client, transport, input);
    assert.equal(retry.reacted, false);
    assert.equal(retry.replied, false);
    assert.equal(retry.resolved, false);
    assert.equal(transport.calls.length, 3);
  }
});


test('bot classification handles 100k spaces and asterisks in under 50 ms', () => {
  const moduleUrl = new URL('../src/findings.ts', import.meta.url).href;
  const script = `import assert from 'node:assert/strict'; import { performance } from 'node:perf_hooks'; import { isInformational, severityOf } from ${JSON.stringify(moduleUrl)};
    for (let i = 0; i < 20; i++) { isInformational('**' + ' '.repeat(200)); severityOf('priority' + ' '.repeat(200)); isInformational('* '.repeat(100)); severityOf('* '.repeat(100)); }
    const bodies = ['**' + ' '.repeat(99998), '* '.repeat(50000), 'priority' + ' '.repeat(100000), '**' + ' '.repeat(99991) + 'medium!'];
    for (const body of bodies) { const start = performance.now(); assert.equal(isInformational(body), false); assert.equal(severityOf(body), 'unknown'); const elapsed = performance.now() - start; assert.ok(elapsed < 50, 'classification took ' + elapsed + ' ms'); console.log(elapsed); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('marker normalization preserves whitespace and literal phrase classification', () => {
  for (const body of ['**' + ' '.repeat(100000) + '🟠' + '\t'.repeat(100000) + 'Major' + '\n'.repeat(100000) + '**', '_\t🟡\nMinor_', 'Severity\t=\ncritical']) assert.equal(isInformational(body + '\nWalkthrough'), false);
  assert.equal(isInformational('Potential\tissue\nWalkthrough'), true);
  for (const [body, expected] of [['priority_-_-=\tmajor', 'high'], ['[\nmedium]', 'medium'], ['_\t🔵\nlow', 'low'], ['severity\t=\nminor', 'low']] as const) assert.equal(severityOf(body), expected);
  assert.equal(isReviewNotice('Walkthrough and summary of changes'), false);
  assert.equal(isReviewNotice('**High**\nFix rate-limit handling'), false);
  for (const body of ['Action not completed', 'No access to this repository', 'No access', 'You do not have access to this repository.', 'Review failed', 'Review skipped']) assert.equal(isReviewNotice(body), true);
});

test('round maps unresolved threads to items with bot, location, severity and summary', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest({ reviews: [], comments: [] });
  const imported = await importFindings(client, pr, findingsOf(pr));
  pr.threads.push({ id: 'human-only', path: 'src/human.ts', line: null, resolved: false, comments: [contribution({ isBot: false, bot: 'reviewer', body: 'Check the boundary.' })] }, { id: 'empty', path: 'src/empty.ts', line: null, resolved: false, comments: [] });
  const items = await reviewItems(client);
  const result = evaluateRound(pr, items);
  assert.deepEqual(result.unresolved_thread_details, [
    { thread_id: 'thread-one', item_id: imported.items[0].id, bot: 'coderabbitai[bot]', path: 'src/input.ts', line: 12, severity: 'high', summary: 'Validate the input before writing.' },
    { thread_id: 'human-only', item_id: null, bot: 'reviewer', path: 'src/human.ts', line: null, severity: 'unknown', summary: 'Check the boundary.' },
    { thread_id: 'empty', item_id: null, bot: 'unknown', path: 'src/empty.ts', line: null, severity: 'unknown', summary: 'Bot review context' },
  ]);
  assert.equal(evaluateRound(pr, []).unresolved_thread_details[0].item_id, null);
  items[0].review_repo = 'other/package';
  assert.equal(evaluateRound(pr, items).unresolved_thread_details[0].item_id, null);
});

test('review find resolves thread ids and comment URLs locally across terminal items', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const pr = pullRequest();
  pr.threads[0].id = 'PRRT_synthetic';
  pr.reviews[0].url = 'https://github.com/example/package/pull/1#pullrequestreview-2';
  pr.comments[0].url = 'https://github.com/example/package/pull/1#issuecomment-3';
  const imported = await importFindings(client, pr, findingsOf(pr));
  await client.update(imported.items[0].id, { status: 'closed', closeReason: 'Synthetic historical context' });
  const ctx: CommandHandlerContext = { command: 'review find', args: [], options: { thread: 'PRRT_synthetic' }, global: { json: true }, pm_root: pmRoot, repo_root: cwd, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') };
  const result = await runReviewCommand(ctx) as { count: number; items: { id: string }[] };
  assert.equal(result.count, 1);
  assert.equal(result.items[0].id, imported.items[0].id);
  assert.equal((await findReviewItems(client, pr.threads[0].comments[0].url))[0].id, imported.items[0].id);
  assert.deepEqual(await findReviewItems(client, 'PRRT_missing'), []);
  for (const thread of [undefined, '', 'bad', 'https://example.test/package/pull/1#discussion_r1', 'https://github.com/example/package/pull/1']) await assert.rejects(runReviewCommand({ ...ctx, options: { thread } }), /PRRT_/);
});
