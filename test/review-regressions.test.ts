import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { runReviewCommand } from '../src/commands.ts';
import { findingsOf, isInformational } from '../src/findings.ts';
import { ensureReviewSchema, fieldOptions, importFindings, reviewItems } from '../src/tracker.ts';
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
