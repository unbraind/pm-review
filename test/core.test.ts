import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import { createExtensionCommandSdk, createPmCliExpectedError, isPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { findingsOf, isInformational, severityOf, summaryOf } from '../src/findings.ts';
import { fieldOptions, ensureReviewSchema, importFindings, precedents, reviewItems } from '../src/tracker.ts';
import { compactRound, evaluateRound } from '../src/round.ts';
import { decide, parseVerdict } from '../src/verdict.ts';
import { runReviewCommand, targetOf } from '../src/commands.ts';
import { contribution, pullRequest, syntheticTransport, tracker } from './helpers.ts';

test('review body sections retain pending findings through import', async t => {
  const { client } = await tracker(t);
  for (const section of ['Outside diff range comments (1)', '🧹 Nitpick comments (2)', '_🛠️ Refactor suggestion_ | _🟠 Major_', '_🟡 Minor_', '_🔴 Critical_']) {
    const body = `**Actionable comments posted: 0**\n${section}\nCorrect the boundary check.`;
    assert.equal(isInformational(body), false, section);
    const pr = pullRequest({ threads: [], comments: [], reviews: [{ ...contribution({ id: section, body }), state: 'COMMENTED' }] });
    await importFindings(client, pr, findingsOf(pr));
    assert.equal(evaluateRound(pr, await reviewItems(client)).pending_items.length, 1);
  }
  assert.equal(isInformational('**Actionable comments posted: 0**\nWalkthrough'), true);
});

test('severity parsing bounds adversarial priority whitespace', () => {
  for (const marker of ['priority high', 'priority_-=\tmajor', 'priority: low']) assert.notEqual(severityOf(marker), 'unknown');
  const moduleUrl = new URL('../src/findings.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { severityOf } from ${JSON.stringify(moduleUrl)}; if (severityOf('priority' + '\\t'.repeat(150_000) + '!') !== 'unknown') process.exit(1);`], { timeout: 5_000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('title parsing bounds adversarial open tags and Markdown whitespace', () => {
  const moduleUrl = new URL('../src/findings.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { summaryOf } from ${JSON.stringify(moduleUrl)}; summaryOf('<'.repeat(150_000)); summaryOf('Title' + ' '.repeat(150_000) + '!');`], { timeout: 5_000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(summaryOf(' ## **Title** \t'), 'Title');
  assert.equal(summaryOf('<b>Title</b>\nSecond'), 'Title');
  assert.equal(summaryOf('  '), 'Bot review context');
});

test('title parsing removes truncated and nested tag delimiters', () => {
  assert.equal(summaryOf('<script'), 'Bot review context');
  assert.equal(summaryOf('Safe <<script>title>'), 'Safe title');
  assert.equal(summaryOf('<script<script>>Fix input'), 'Fix input');
});

test('round rejects completion replies for an unreviewed head with an older commit date', () => {
  const pr = pullRequest({ reviews: [], threads: [], headDate: '2026-10-12T10:05:00Z', comments: [contribution({ body: 'Full review finished.', head: null, createdAt: '2026-10-12T10:10:00Z' })] });
  assert.equal(evaluateRound(pr, []).coderabbit_finished, false);
  pr.threads.push({ id: 'old-review', path: 'src/input.ts', line: 1, resolved: true, comments: pr.comments });
  pr.comments = [];
  assert.equal(evaluateRound(pr, []).coderabbit_finished, false);
});

test('pending apply fails before transport reads and tracker writes', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest();
  const imported = await importFindings(client, pr, findingsOf(pr));
  const transport = syntheticTransport(pr);
  let reads = 0;
  transport.snapshot = async () => { reads++; return pr; };
  const input = { id: imported.items[0].id, repo: pr.repo, pr: pr.number, verdict: parseVerdict('pending'), reason: 'Awaiting evidence', commit: '', apply: true };
  const before = (await client.get(input.id, { depth: 'full' })).item;
  await assert.rejects(decide(client, transport, input), /final verdict/);
  assert.equal(reads, 0);
  assert.deepEqual(transport.calls, []);
  assert.deepEqual((await client.get(input.id, { depth: 'full' })).item, before);
  assert.equal((await client.comments(input.id)).comments.length, 0);
  assert.equal(pr.threads[0].resolved, false);
  assert.equal((await decide(client, undefined, { ...input, apply: false })).applied, false);
});

 test('marker parsing preserves actionability and all four supported bot severities', () => {
  for (const body of ['Rate-limit exceeded', 'Trial ended', 'Review failed', 'Walkthrough', 'Full review finished', 'No actionable comments', 'Review skipped', 'Summary of changes']) assert.equal(isInformational(body), true);
  assert.equal(isInformational('Validate input before writes'), false);
  // Real notices observed on fleet PRs: Sourcery budget/guide comments and CodeRabbit's manual-review notice.
  for (const body of ["Sorry @maintainer, you've used your own review budget of 250,000 diff characters for the last 7 days.", '> [!IMPORTANT]\n> - [ ] 🔍 Trigger review\n>\n> This repository does not receive automatic reviews.', "## Reviewer's Guide\n\nThe PR fixes a publication-ordering defect."]) assert.equal(isInformational(body), true, body);
  assert.equal(summaryOf('> [!IMPORTANT]\n> This repository does not receive automatic reviews.'), 'This repository does not receive automatic reviews.');
  assert.equal(isInformational('_Potential issue_ | _🟠 Major_\nFix rate-limit backoff in the walkthrough generator.'), false);
  assert.equal(isInformational('Severity: high\nRate-limit responses must be retried.'), false);
  assert.equal(isInformational('Potential issue\nFix quota exceeded handling.'), false);
  assert.equal(isInformational('_Nitpick_\nImprove the walkthrough formatting.'), false);
  assert.equal(isInformational('![medium-priority](image)\nHandle review failed responses.'), false);
  for (const [body, expected] of [['_🟠 Major_', 'high'], ['_🟡 Minor_', 'low'], ['**🩺 Stability & Availability** | **🟠 Major** | **⚡ Quick win**', 'high'], ['**🎯 Functional Correctness** | **🟡 Minor** | **⚡ Quick win**', 'low'], ['🔴 Critical', 'critical'], ['Severity: high', 'high'], ['[medium]', 'medium'], ['![high-priority](image)', 'high'], ['![medium_priority](image)', 'medium'], ['unmarked', 'unknown']]) assert.equal(severityOf(body), expected);
  assert.equal(summaryOf(contribution().body), 'Validate the input before writing.');
  assert.equal(summaryOf(''), 'Bot review context');
  assert.equal(summaryOf('x'.repeat(250)).length, 200);
 });

 test('findings cover bot threads, review bodies and issue comments with human and empty filtering', () => {
  const pr = pullRequest();
  pr.threads.push({ id: 'human-thread', path: 'src/x.ts', line: null, resolved: true, comments: [contribution({ isBot: false })] });
  pr.reviews.push({ ...contribution({ id: 'empty', body: '' }), state: 'COMMENTED' }, { ...contribution({ id: 'human-review', isBot: false }), state: 'COMMENTED' });
  pr.comments.push(contribution({ isBot: false }));
  const findings = findingsOf(pr);
  assert.equal(findings.length, 3);
  assert.equal(findings[0].id, 'thread-one');
  assert.equal(findings[0].path, 'src/input.ts');
  assert.equal(findings[2].verdict, 'informational');
 });

 test('real SDK upsert preserves verdict, comments, body, schema and pm search visibility', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest();
  const first = await importFindings(client, pr, findingsOf(pr));
  assert.equal(first.created, 3);
  const id = first.items[0].id;
  const input = { id, repo: pr.repo, pr: pr.number, verdict: parseVerdict('refuse'), reason: 'Existing schema validation prevents invalid input.', commit: 'b'.repeat(40), apply: false };
  await decide(client, undefined, input);
  await decide(client, undefined, input);
  assert.equal((await client.comments(id)).comments.length, 1);
  pr.threads[0].comments[0].body = 'Updated validation finding';
  pr.threads[0].resolved = true;
  pr.threads[0].line = null;
  const again = await importFindings(client, pr, findingsOf(pr));
  assert.equal(again.created, 0);
  assert.equal(again.updated, 3);
  const item = (await client.get(id, { depth: 'full' })).item;
  assert.equal(item.review_verdict, 'refuse');
  assert.equal(item.review_resolved, true);
  assert.match(String(item.body), /PR commits:/);
  assert.equal((await reviewItems(client)).length, 3);
  assert.equal((await precedents(client, 'schema validation')).length, 1);
  assert.equal((await precedents(client, 'schema', pr.repo, pr.number))[0].commit, 'b'.repeat(40));
  assert.equal((await precedents(client, 'schema', 'other/package', pr.number)).length, 0);
  assert.equal((await precedents(client, 'schema', pr.repo, 2)).length, 0);
  await assert.rejects(precedents(client, ' '), /nonempty/);
  const search = await client.search('validation', { mode: 'keyword', full: true });
  assert.ok(search.count > 0);
  await client.update(id, { ...fieldOptions({review_verdict: 'fix'}), status: 'closed', closeReason: 'Synthetic historical precedent' });
  assert.equal((await precedents(client, 'validation')).length, 1);
  await ensureReviewSchema(client);
 });

 test('persisted incompatible fields fail before any import', async t => {
  const { client } = await tracker(t);
  await client.run('schema', { name: 'review_bot', options: { subcommand: 'add-field', fieldType: 'boolean' } });
  await assert.rejects(ensureReviewSchema(client), /Incompatible schema field/);
 });

 test('verdict validations fail before local or remote writes', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest();
  const imported = await importFindings(client, pr, findingsOf(pr));
  const input = { id: imported.items[0].id, repo: pr.repo, pr: pr.number, verdict: parseVerdict('fix'), reason: 'Validated', commit: 'b'.repeat(40), apply: false };
  assert.throws(() => parseVerdict('unknown'), /Invalid verdict/);
  await assert.rejects(decide(client, undefined, { ...input, reason: ' ' }), /nonempty/);
  await assert.rejects(decide(client, undefined, { ...input, commit: 'invalid' }), /SHA/);
  await assert.rejects(decide(client, undefined, { ...input, id: 'missing' }), /not found/);
  await assert.rejects(decide(client, undefined, { ...input, repo: 'other/package' }), /different/);
  await assert.rejects(decide(client, undefined, { ...input, pr: 9 }), /different/);
  await assert.rejects(decide(client, undefined, { ...input, apply: true, id: imported.items[1].id }), /transport/);
  await assert.rejects(decide(client, undefined, { ...input, apply: true }), /transport/);
  await assert.rejects(decide(client, syntheticTransport({ ...pr, threads: [] }), { ...input, apply: true }), /no longer exists/);
  const human = structuredClone(pr); human.threads[0].comments[0].isBot = false;
  await assert.rejects(decide(client, syntheticTransport(human), { ...input, apply: true }), /no bot/);
  assert.equal((await client.comments(input.id)).comments.length, 0);
 });

 test('apply writes only synthetic threads and retries without duplicate replies, votes or resolutions', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest(); pr.threads[0].comments[0].reactions = [{ content: 'THUMBS_UP', user: 'another-user' }];
  const imported = await importFindings(client, pr, findingsOf(pr));
  const transport = syntheticTransport(pr);
  const input = { id: imported.items[0].id, repo: pr.repo, pr: pr.number, verdict: parseVerdict('fix'), reason: 'Input validated before mutation.', commit: 'b'.repeat(40), apply: true };
  assert.deepEqual(await decide(client, transport, input), { item: input.id, verdict: 'fix', applied: true, replied: true, reacted: true, resolved: true });
  assert.deepEqual(transport.calls, ['reply', 'THUMBS_UP', 'resolve']);
  const second = await decide(client, transport, input);
  assert.equal(second.replied, false); assert.equal(second.reacted, false); assert.equal(second.resolved, false);
  await decide(client, transport, { ...input, verdict: 'refuse', commit: '' });
  await decide(client, transport, { ...input, verdict: 'informational' });
  await decide(client, transport, { ...input, verdict: 'duplicate' });
  await decide(client, transport, { ...input, verdict: 'stale' });
  assert.equal(transport.calls.filter(call => call === 'THUMBS_DOWN').length, 1);
  assert.equal(transport.calls.filter(call => call === 'THUMBS_UP').length, 1);
 });

 test('round requires current finished review, successful checks, author votes and complete durable decisions', async t => {
  const { client } = await tracker(t);
  const pr = pullRequest();
  const imported = await importFindings(client, pr, findingsOf(pr));
  let items = await reviewItems(client);
  assert.equal(evaluateRound(pr, items).complete, false);
  assert.equal(evaluateRound(pr, []).unimported_nodes.length, 3);
  for (const item of imported.items) await decide(client, undefined, { id: item.id, repo: pr.repo, pr: pr.number, verdict: parseVerdict('fix'), reason: 'Synthetic verified correction', commit: '', apply: false });
  items = await reviewItems(client); pr.threads[0].resolved = true;
  const result = evaluateRound(pr, items);
  assert.equal(result.complete, true);
  assert.match(compactRound(result), /complete=true checks=pass coderabbit=finished/);
  assert.equal(evaluateRound({ ...pr, checks: [] }, items).checks, 'pending');
  assert.equal(evaluateRound({ ...pr, checks: [{ name: 'CI', state: 'pending' }] }, items).checks, 'pending');
  assert.equal(evaluateRound({ ...pr, checks: [{ name: 'CI', state: 'fail' }] }, items).checks, 'fail');
  const old = structuredClone(pr); old.reviews[0].head = 'old'; old.comments[0].createdAt = old.headDate;
  assert.equal(evaluateRound(old, items).coderabbit_finished, false);
  old.comments[0].createdAt = '2026-10-12T10:00:00Z';
  assert.equal(evaluateRound(old, items).coderabbit_finished, false);
  old.comments[0].body = 'Rate-limit exceeded';
  assert.equal(evaluateRound(old, items).coderabbit_finished, false);
  old.threads[0].comments.push(contribution({ id: 'done', body: 'Full review finished.' }));
  assert.equal(evaluateRound(old, items).coderabbit_finished, false);
  const none = structuredClone(pr); none.reviews[0].state = 'PENDING'; none.comments = [];
  assert.equal(evaluateRound(none, items).coderabbit_finished, false);
  none.comments = [contribution({ body: 'Full review finished.' })];
  assert.equal(evaluateRound(none, items).coderabbit_finished, false);
  none.comments = [];
  none.reviews[0].state = 'COMMENTED'; none.reviews[0].body = 'Review failed';
  assert.equal(evaluateRound(none, items).coderabbit_finished, false);
  none.reviews[0].isBot = false;
  assert.equal(evaluateRound(none, items).coderabbit_finished, false);
  none.reviews[0].body = '';
  none.threads[0].comments[0].reactions = [{ content: 'THUMBS_UP', user: 'other' }];
  assert.equal(evaluateRound(none, items).unvoted_bot_comments.length, 1);
  const other = structuredClone(items); other[0].review_pr = 7; other[1].review_repo = 'different/package';
  assert.equal(evaluateRound(pr, other).unimported_nodes.length, 2);
 });

 test('commands validate coordinates and use real host SDK context with structured exits and compact rendering', async t => {
  const { client, pmRoot, cwd } = await tracker(t);
  assert.deepEqual(targetOf({ repo: 'example/package', pr: '1' }), { repo: 'example/package', pr: 1 });
  for (const options of [{}, { repo: 'invalid', pr: '1' }, { repo: 'example/package', pr: '0' }, { repo: 'example/package', pr: '1.5' }, { repo: 'example/package', pr: '9999999999999999999' }]) assert.throws(() => targetOf(options));
  const pr = pullRequest(); const transport = syntheticTransport(pr);
  const ctx: CommandHandlerContext = { command: 'review import', args: [], options: { repo: pr.repo, pr: '1' }, global: { json: true }, pm_root: pmRoot, source_workspace_root: cwd };
  await runReviewCommand(ctx, transport);
  const id = (await reviewItems(client)).find(item => item.review_kind === 'thread')!.id;
  ctx.command = 'review verdict'; ctx.args = [id, 'refuse']; ctx.options.reason = 'Existing validation';
  await runReviewCommand(ctx, transport);
  ctx.command = 'review precedents'; ctx.args = ['validation'];
  const result = await runReviewCommand(ctx, transport) as { count: number };
  assert.equal(result.count, 1);
  ctx.options = {}; await runReviewCommand(ctx);
  ctx.args = []; await assert.rejects(runReviewCommand(ctx), /nonempty/);
  ctx.command = 'review round'; ctx.args = []; ctx.options = { repo: pr.repo, pr: '1' };
  assert.equal((await runReviewCommand(ctx, transport) as { exit_code: number }).exit_code, 1);
  ctx.options.compact = true;
  assert.ok('checks' in (await runReviewCommand(ctx, transport) as object));
  ctx.global = { quiet: true, author: 'test-agent' };
  assert.ok('__pm_suppress_host_output' in (await runReviewCommand(ctx, transport) as object));
  ctx.sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
  await runReviewCommand(ctx, transport);
  ctx.command = 'review invalid'; await assert.rejects(runReviewCommand(ctx, transport), /Unknown/);
  ctx.command = 'review verdict'; ctx.args = [id, 'fix']; ctx.options.reason = 'New validation'; ctx.options.commit = 'b'.repeat(40); ctx.options.apply = true;
  await runReviewCommand(ctx, transport);
 });

 test('extension activation exposes all commands and runs through the real host dispatcher', async t => {
  const { client, pmRoot } = await tracker(t);
  const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  assert.equal(activation.commands.handlers.length, 6);
  const result = await runRegisteredCommandForTest(activation.commands, { command: 'review precedents', args: ['validation'], pmRoot, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') });
  assert.equal(result.handled, true);
  assert.deepEqual(result.result, { query: 'validation', count: 0, items: [] });
 });

 test('compact complete rounds retain a successful host exit', async t => {
  const { client, pmRoot, cwd } = await tracker(t);
  const pr = pullRequest({ threads: [], reviews: [{ ...contribution({ body: '', id: 'complete' }), state: 'COMMENTED' }], comments: [] });
  await importFindings(client, pr, findingsOf(pr));
  const ctx: CommandHandlerContext = { command: 'review round', args: [], options: { repo: pr.repo, pr: '1', compact: true }, global: { quiet: true }, pm_root: pmRoot, repo_root: cwd };
  const result = await runReviewCommand(ctx, syntheticTransport(pr)) as { exit_code: number };
  assert.equal(result.exit_code, 0);
  assert.match(compactRound(evaluateRound(pr, await reviewItems(client))), /coderabbit=finished/);
  assert.match(compactRound(evaluateRound(pullRequest({ reviews: [], comments: [] }), [])), /coderabbit=missing/);
 });

test('extension failures leave as host-expected errors so the CLI renders the real message', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const pr = pullRequest();
  const imported = await importFindings(client, pr, findingsOf(pr));
  const ctx: CommandHandlerContext = { command: 'review verdict', args: [], options: { repo: pr.repo, pr: '1', reason: 'Synthetic decision', commit: 'b'.repeat(40) }, global: { json: true }, pm_root: pmRoot, source_workspace_root: cwd };
  await assert.rejects(runReviewCommand(ctx), error => isPmCliExpectedError(error) && /Invalid verdict/.test(error.message));
  await assert.rejects(runReviewCommand({ ...ctx, args: [imported.items[0].id, 'bogus'] }), error => isPmCliExpectedError(error) && /Invalid verdict/.test(error.message));
  await assert.rejects(runReviewCommand({ ...ctx, args: [imported.items[0].id, 'fix'], options: { ...ctx.options, reason: '' } }), error => isPmCliExpectedError(error) && /nonempty/.test(error.message));
  await assert.rejects(runReviewCommand({ ...ctx, args: ['unknown-item', 'fix'] }), error => isPmCliExpectedError(error) && /not found/.test(error.message));
  await assert.rejects(runReviewCommand({ ...ctx, command: 'review round', options: { repo: 'bad', pr: '1' } }, syntheticTransport(pr)), error => isPmCliExpectedError(error) && /owner\/name/.test(error.message));
  await assert.rejects(runReviewCommand({ ...ctx, command: 'review invalid' }, syntheticTransport(pr)), error => isPmCliExpectedError(error) && /Unknown pm-review command/.test(error.message));
  const importContext = { ...ctx, command: 'review import' };
  const transport = syntheticTransport(pr);
  const expected = createPmCliExpectedError('Synthetic expected transport failure');
  transport.snapshot = async () => { throw expected; };
  await assert.rejects(runReviewCommand(importContext, transport), error => error === expected);
  transport.snapshot = async () => { throw 'Synthetic non-Error transport failure'; };
  await assert.rejects(runReviewCommand(importContext, transport), error => isPmCliExpectedError(error) && error.message === 'Synthetic non-Error transport failure');
  const original = globalThis.fetch;
  const token = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'synthetic-only-token';
  globalThis.fetch = async () => { throw new Error('synthetic network refusal'); };
  t.after(() => { globalThis.fetch = original; if (token === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = token; });
  await assert.rejects(runReviewCommand({ ...ctx, args: [imported.items[0].id, 'fix'], options: { ...ctx.options, apply: true } }), error => isPmCliExpectedError(error) && /synthetic network refusal/.test(error.message));
  await assert.rejects(runReviewCommand(importContext), error => isPmCliExpectedError(error) && /synthetic network refusal/.test(error.message));
});
