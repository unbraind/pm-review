import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { TestContext } from 'node:test';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import { createGitHubTransport } from '../src/github.ts';
import { runReviewCommand } from '../src/commands.ts';
import { findingsOf } from '../src/findings.ts';
import { respond, responsePlan, responseMarker, reviewStatus } from '../src/respond.ts';
import { fieldOptions, importFindings, recordVerdict, reviewItems } from '../src/tracker.ts';
import type { Contribution, PullRequest } from '../src/types.ts';
import { contribution, pullRequest, tracker } from './helpers.ts';

/** Serve real HTTP fixtures behind the existing injectable fetch boundary, including nested pagination. */
async function fixture(t: TestContext, pr: PullRequest) {
  const writes: string[] = [];
  let fail = '';
  let failureKind = 'graphql';
  /** Encode one page at a time, forcing complete pagination for every connection. */
  const page = (nodes: unknown[], cursor: unknown = null) => {
    const index = cursor === null ? 0 : Number(cursor);
    return { nodes: nodes.slice(index, index + 1), pageInfo: { hasNextPage: index + 1 < nodes.length, endCursor: String(index + 1) } };
  };
  /** All sources are reactable, including human contributions that must remain untouched. */
  const sources = () => [...pr.comments, ...pr.reviews, ...pr.threads.flatMap(thread => thread.comments)];
  /** Map a durable contribution back into a GitHub API fixture. */
  const raw = (source: Contribution) => ({ ...source, author: { login: source.bot, __typename: source.isBot ? 'Bot' : 'User' }, originalCommit: { oid: pr.head }, commit: { oid: source.head }, reactions: page(source.reactions.map(reaction => ({ content: reaction.content, user: { login: reaction.user } }))) });
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const { query, variables: v } = JSON.parse(body) as { query: string; variables: Record<string, string | null> };
    const operation = /(?:query|mutation) (\w+)/.exec(query)![1];
    if (operation === fail) {
      res.end(JSON.stringify(failureKind === 'graphql' ? { data: {}, errors: [{ message: 'partial response' }] } : { data: { repository: { pullRequest: { headRefOid: pr.head, comments: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } } } }));
      return;
    }
    let data: unknown;
    const pull: Record<string, unknown> = { headRefOid: pr.head, author: { login: pr.author } };
    if (operation === 'ViewerLogin') data = { viewer: { login: pr.author } };
    else if (operation === 'ReplyThread') {
      writes.push(operation);
      pr.threads.find(thread => thread.id === v.thread)!.comments.push(contribution({ id: 'reply-' + writes.length, isBot: false, bot: pr.author, body: v.body!, reactions: [] }));
      data = { addPullRequestReviewThreadReply: {} };
    } else if (operation === 'React') {
      writes.push(operation + ':' + v.node + ':' + v.content);
      sources().find(source => source.id === v.node)!.reactions.push({ content: v.content!, user: pr.author });
      data = { addReaction: {} };
    } else if (operation === 'ResolveThread') {
      writes.push(operation);
      pr.threads.find(thread => thread.id === v.thread)!.resolved = true;
      data = { resolveReviewThread: {} };
    } else if (operation === 'SnapshotThreadReplies') {
      data = { node: { __typename: 'PullRequestReviewThread', comments: page(pr.threads.find(thread => thread.id === v.thread)!.comments.map(raw), v.cursor) } };
    } else if (operation === 'SnapshotReactions') {
      data = { node: { __typename: 'IssueComment', reactions: page(sources().find(source => source.id === v.node)!.reactions.map(reaction => ({ content: reaction.content, user: { login: reaction.user } })), v.cursor) } };
    } else if (operation === 'SnapshotChecks') {
      data = { repository: { object: { __typename: 'Commit', oid: pr.head, committedDate: pr.headDate, checkSuites: page([]) } } };
    } else {
      if (operation === 'SnapshotThreads') pull.reviewThreads = page(pr.threads.map(thread => ({ id: thread.id, isResolved: thread.resolved, path: thread.path, line: thread.line, comments: page(thread.comments.map(raw)) })), v.cursor);
      if (operation === 'SnapshotReviews') pull.reviews = page(pr.reviews.map(raw), v.cursor);
      if (operation === 'SnapshotComments') pull.comments = page(pr.comments.map(raw), v.cursor);
      if (operation === 'SnapshotCommits') pull.commits = page(pr.commits.map(commit => ({ commit: { oid: commit.sha, committedDate: commit.date, url: commit.url } })), v.cursor);
      data = { repository: { pullRequest: pull } };
    }
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const transport = createGitHubTransport({ token: 'synthetic-token', pageSize: 1, fetch: async (url, init) => {
    if (init.method === 'GET') return new Response('[]');
    assert.equal(url, 'https://api.github.com/graphql');
    return fetch(`http://127.0.0.1:${address.port}`, init);
  } });
  return { transport, writes, fail(operation: string, kind = 'graphql') { fail = operation; failureKind = kind; } };
}

/** Start a real tracker with one final decision, retaining notices and all API item categories. */
async function scenario(t: TestContext) {
  const local = await tracker(t);
  const pr = pullRequest();
  pr.comments = [contribution({ id: 'notice', body: 'Trial ended', reactions: [] }), contribution({ id: 'human', bot: 'maintainer', isBot: false, reactions: [] }), contribution({ id: 'custom', bot: 'custom-review[bot]', body: 'Service unavailable', reactions: [] })];
  pr.reviews[0].reactions = [{ content: 'HEART', user: pr.author }, { content: 'THUMBS_UP', user: 'other' }];
  pr.threads[0].comments[0].reactions = [];
  pr.threads[0].comments.push(contribution({ id: 'bot-followup', reactions: [] }));
  await importFindings(local.client, pr, findingsOf(pr));
  const items = await reviewItems(local.client);
  const item = items.find(candidate => candidate.review_kind === 'thread')!;
  await recordVerdict(local.client, item, 'fix', 'Validate input before writes.', 'b'.repeat(40));
  return { ...local, pr, item, ...await fixture(t, pr) };
}

test('respond HTTP dry-run, fix/refusal votes, pagination and finding markers make retries inert', async t => {
  const s = await scenario(t);
  const first = await respond(s.client, s.transport, s.pr.repo, 1);
  assert.equal(first.dry_run, true);
  assert.deepEqual(first.actions.map(action => action.kind), ['reply', 'vote', 'vote', 'vote', 'vote']);
  assert.equal(s.writes.length, 0);
  const reply = first.actions.find(action => action.kind === 'reply')!;
  const decision = (await reviewItems(s.client)).find(item => item.id === reply.finding)!;
  assert.ok(reply.body.includes(responseMarker(decision)));
  assert.match(reply.body, / decision:[a-f0-9]{16} -->$/);
  assert.match(reply.body, /fix\n\nValidate input before writes\.\n\nCommit: b{40}/);
  assert.doesNotMatch(reply.body, /Potential issue|synthetic-token|maintainer|@/);
  const applied = await respond(s.client, s.transport, s.pr.repo, 1, { apply: true });
  assert.deepEqual(applied.actions, first.actions);
  assert.equal(s.pr.threads[0].resolved, false);
  assert.ok(s.writes.includes('React:notice:THUMBS_DOWN'));
  assert.ok(s.writes.includes('React:review-one:THUMBS_UP'));
  assert.ok(s.writes.includes('React:bot-followup:THUMBS_UP'));
  assert.equal(s.writes.some(write => write.includes('human') || write.includes('custom')), false);
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true })).actions, []);
  // Altering surrounding text cannot defeat the stable marker; another actor's marker cannot satisfy it.
  s.pr.threads[0].comments.at(-1)!.body = 'Changed surrounding text\n' + responseMarker(decision);
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1)).actions, []);
  s.pr.threads[0].comments.at(-1)!.bot = 'another-human';
  assert.equal((await respond(s.client, s.transport, s.pr.repo, 1)).actions[0].kind, 'reply');
  s.pr.threads[0].comments.at(-1)!.bot = s.pr.author;
  await recordVerdict(s.client, s.item, 'refuse', 'Existing validation covers this input.', '');
  s.pr.threads[0].comments[0].reactions = [];
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true, resolve: true })).actions.map(action => action.kind), ['reply', 'resolve', 'vote']);
  assert.match(s.pr.threads[0].comments.at(-1)!.body, /pm-review: refuse[\s\S]*supersedes the earlier reply/);
  assert.ok(s.pr.threads[0].resolved);
  assert.ok(s.writes.includes('React:comment-one:THUMBS_UP'));
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true, resolve: true })).actions, []);
});

test('respond HTTP changed reason is stale until exactly one superseding reply; unchanged decisions stay inert', async t => {
  const s = await scenario(t);
  for (const item of await reviewItems(s.client)) {
    await recordVerdict(s.client, item, 'refuse', 'Existing validation covers this input.', '');
  }
  await respond(s.client, s.transport, s.pr.repo, 1, { apply: true, resolve: true });
  assert.equal((await reviewStatus(s.client, s.transport, s.pr.repo, 1)).complete, true);
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true })).actions, []);
  const earlier = s.pr.threads[0].comments.at(-1)!;
  const originalBody = earlier.body;
  const writes = s.writes.length;
  await recordVerdict(s.client, s.item, 'refuse', 'The boundary validator already rejects malformed input.', '');
  const stale = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
  assert.deepEqual(stale.stale_replies, [s.item.id]);
  assert.deepEqual(stale.verdicts_without_reply, []);
  assert.equal(stale.complete, false);
  assert.equal(stale.exit_code, 1);
  assert.equal(s.writes.length, writes);
  const correction = await respond(s.client, s.transport, s.pr.repo, 1, { apply: true });
  assert.deepEqual(correction.actions.map(action => action.kind), ['reply']);
  assert.deepEqual(s.writes.slice(writes), ['ReplyThread']);
  const latest = s.pr.threads[0].comments.at(-1)!;
  assert.match(latest.body, /The boundary validator already rejects malformed input\.[\s\S]*supersedes the earlier reply/);
  assert.notEqual(latest.body, originalBody);
  assert.ok(s.pr.threads[0].comments.includes(earlier));
  assert.equal(earlier.body, originalBody);
  const current = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
  assert.deepEqual(current.stale_replies, []);
  assert.equal(current.complete, true);
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true })).actions, []);
  assert.equal(s.writes.length, writes + 1);
});

test('respond HTTP legacy marker is stale and a changed fix commit requires a new reply', async t => {
  const s = await scenario(t);
  const legacyBody = `Earlier decision\n\n<!-- pm-review:finding:${encodeURIComponent(s.item.id)} -->`;
  s.pr.threads[0].comments.push(contribution({ id: 'legacy-reply', bot: s.pr.author, isBot: false, body: legacyBody, reactions: [] }));
  const stale = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
  assert.equal(stale.exit_code, 1);
  assert.deepEqual(stale.stale_replies, [s.item.id]);
  assert.deepEqual(stale.verdicts_without_reply, []);
  const migrated = await respond(s.client, s.transport, s.pr.repo, 1, { apply: true });
  assert.equal(migrated.actions.filter(action => action.kind === 'reply').length, 1);
  assert.match(s.pr.threads[0].comments.at(-1)!.body, /supersedes the earlier reply/);
  assert.equal(s.pr.threads[0].comments.find(comment => comment.id === 'legacy-reply')!.body, legacyBody);
  assert.deepEqual((await reviewStatus(s.client, s.transport, s.pr.repo, 1)).stale_replies, []);
  await recordVerdict(s.client, s.item, 'fix', 'Validate input before writes.', 'c'.repeat(40));
  assert.deepEqual((await reviewStatus(s.client, s.transport, s.pr.repo, 1)).stale_replies, [s.item.id]);
  const changed = await respond(s.client, s.transport, s.pr.repo, 1, { apply: true });
  assert.deepEqual(changed.actions.map(action => action.kind), ['reply']);
  assert.match(s.pr.threads[0].comments.at(-1)!.body, /Commit: c{40}[\s\S]*supersedes the earlier reply/);
  assert.deepEqual((await respond(s.client, s.transport, s.pr.repo, 1, { apply: true })).actions, []);
});

test('respond configuration, status blockers and registered command exits share the same complete reads', async t => {
  const s = await scenario(t);
  const ctx = { command: 'review status', args: [], options: { repo: s.pr.repo, pr: '1' }, global: { json: true }, pm_root: s.pmRoot, sdk: createExtensionCommandSdk(s.pmRoot, s.client, 'test-agent') };
  const before = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
  assert.equal(before.exit_code, 1);
  assert.deepEqual(before.verdicts_without_reply, [s.item.id]);
  assert.equal(before.findings_without_verdict.length, 2);
  assert.equal(before.current_head_review_completed, true);
  assert.equal((await runReviewCommand(ctx, s.transport) as { exit_code: number }).exit_code, 1);
  ctx.command = 'review respond';
  assert.equal((await runReviewCommand(ctx, s.transport) as { dry_run: boolean }).dry_run, true);
  const custom = await respond(s.client, s.transport, s.pr.repo, 1, { bots: 'CUSTOM-REVIEW[bot],maintainer', noticePattern: '^Service unavailable$' });
  assert.deepEqual(custom.actions.filter(action => action.kind === 'vote'), [{ kind: 'vote', node: 'custom', content: 'THUMBS_DOWN' }]);
  await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { noticePattern: '[' }), /regular expression/i);
  for (const item of await reviewItems(s.client)) {
    if (item.id !== s.item.id) await recordVerdict(s.client, item, 'refuse', 'No code change needed.', '');
  }
  await respond(s.client, s.transport, s.pr.repo, 1, { apply: true, resolve: true });
  const clear = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
  assert.equal(clear.complete, true);
  assert.equal('exit_code' in clear, false);
  const pr = pullRequest({ threads: [], comments: [], reviews: [] });
  assert.equal(responsePlan(pr, [], 'author', {}).actions.length, 0);
  s.pr.reviews = [];
  assert.equal((await reviewStatus(s.client, s.transport, s.pr.repo, 1)).current_head_review_completed, false);
});

test('respond fails before every write on unsafe verdicts, missing threads and partial API data', async t => {
  const s = await scenario(t);
  for (const reason of ['Mention ' + '@' + 'review-bot', 'File ' + '/' + ['home', 'private', 'file'].join('/'), 'File ' + '/' + ['tmp', 'private'].join('/'), 'Bearer secret', 'github_pat_secret', 'ghp_secret', 'sk-secret', '<!-- injected -->']) {
    await recordVerdict(s.client, s.item, 'fix', reason, 'b'.repeat(40));
    await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { apply: true }), /Unsafe verdict/);
  }
  await recordVerdict(s.client, s.item, 'fix', 'Safe reasoning.', 'b'.repeat(40));
  s.fail('SnapshotComments');
  await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { apply: true }), /GraphQL reported/);
  await assert.rejects(reviewStatus(s.client, s.transport, s.pr.repo, 1), /GraphQL reported/);
  s.fail('SnapshotComments', 'cursor');
  await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { apply: true }), /end cursor/);
  s.fail('');
  s.pr.threads = [];
  await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { apply: true }), /thread is missing/);
  assert.equal(s.writes.length, 0);
});

test('partial mutation failure retains recorded decision and marker makes retry resume remaining actions', async t => {
  const s = await scenario(t);
  s.fail('React');
  await assert.rejects(respond(s.client, s.transport, s.pr.repo, 1, { apply: true }), /GraphQL reported/);
  assert.deepEqual(s.writes, ['ReplyThread']);
  s.fail('');
  const retry = await respond(s.client, s.transport, s.pr.repo, 1, { apply: true });
  assert.equal(retry.actions.some(action => action.kind === 'reply'), false);
  assert.equal((await s.client.get(s.item.id)).item.review_reason, 'Validate input before writes.');
});

test('status treats incomplete decisions as missing and accepts only final reasoned records', async t => {
  const s = await scenario(t);
  for (const fields of [{ review_verdict: 'pending' }, { review_verdict: 'fix', review_commit: '' }, { review_verdict: 'refuse', review_reason: '' }] as Record<string, string>[]) {
    await s.client.update(s.item.id, fieldOptions(fields));
    const status = await reviewStatus(s.client, s.transport, s.pr.repo, 1);
    assert.ok(status.findings_without_verdict.includes(s.item.id));
    assert.equal(status.verdicts_without_reply.includes(s.item.id), false);
  }
  await recordVerdict(s.client, s.item, 'refuse', 'Existing validation is sufficient.', '');
  const result = await respond(s.client, s.transport, s.pr.repo, 1);
  const reply = result.actions.find(action => action.kind === 'reply')!;
  assert.match(reply.body, /pm-review: refuse/);
  assert.doesNotMatch(reply.body, /Commit:/);
  const blank = pullRequest({ threads: [], comments: [], reviews: [] });
  const empty = await fixture(t, blank);
  assert.equal((await reviewStatus(s.client, empty.transport, 'other/package', 7)).exit_code, 1);
});
