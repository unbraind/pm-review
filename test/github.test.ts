/**
 * Tests for the GitHub transport.
 *
 * The happy path replays real read-only fixtures recorded against public
 * pull request unbraind/pm-rl#68 (every page, reply and status captured via
 * the production queries; no mutation was ever sent). Synthetic scenarios
 * cover pagination beyond 100 nodes for every connection, fail-closed
 * validation of nullable and malformed responses, cursor abuse, head
 * changes, the mutation surface (only ever exercised against a synthetic
 * transport) and token resolution.
 */
import { deepEqual, equal, match, ok, rejects, throws } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  checkOutcome, createGitHubTransport, ghAuthToken, isBotAuthor, resolveGitHubToken,
  type FetchLike, type TransportResponse, type TransportRequestInit,
} from '../src/github.ts';
import type { Contribution, GitHubTransport, PullRequest } from '../src/types.ts';

/** Token injected into every synthetic transport; assertions prove it never leaks into errors. */
const TOKEN = 'fixture-token';
/** Fixed production GraphQL endpoint, asserted on every replayed request. */
const GRAPHQL_URL = 'https://api.github.com/graphql';
/** Synthetic head commit of the snapshot. */
const HEAD_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
/** Synthetic original commit referenced by comments and reviews. */
const HEAD_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
/** Synthetic timestamp shared by the synthetic fixtures. */
const WHEN = '2026-10-01T00:00:00Z';

/** One scripted or recorded response served by a fake fetch boundary. */
interface Scripted {
  status?: number;
  body?: unknown;
  text?: string;
  link?: string | null;
  match?: RegExp;
}

/** One request/response pair recorded from the real GitHub API. */
interface RecordedEntry {
  url: string;
  method: string;
  status: number;
  link: string | null;
  body: string;
  query?: string;
  variables?: Record<string, unknown>;
}

/** One recorded read-only transcript. */
interface Transcript {
  repo: string;
  pr: number;
  login?: string;
  pageSize: number;
  requests: RecordedEntry[];
}

/** Load one recorded fixture from the fixtures directory. */
function loadFixture(name: string): Transcript {
  return JSON.parse(readFileSync(new URL(`./fixtures/pm-rl-68/${name}`, import.meta.url), 'utf8')) as Transcript;
}

/** Build one response for a fake fetch boundary. */
function respond(status: number, body: string, link: string | null): TransportResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'link' ? link : null) },
    text: async () => body,
  };
}

/** Assert the request envelope shared by every synthetic transport call. */
function checkEnvelope(url: string, init: TransportRequestInit, expected?: RegExp, token = TOKEN): void {
  equal(init.redirect, 'error');
  equal(init.headers.authorization, `Bearer ${token}`);
  ok(init.signal instanceof AbortSignal);
  if (expected !== undefined) ok(expected.test(init.body ?? ''), `request body must match ${expected}`);
}

/** Build a fetch boundary that serves a scripted response queue in order. */
function scriptFetch(script: Scripted[], token = TOKEN): FetchLike {
  let index = 0;
  return async (url, init) => {
    ok(index < script.length, `synthetic transport requested response ${index + 1} beyond the scripted queue`);
    const next = script[index];
    index++;
    checkEnvelope(url, init, next.match, token);
    if (init.method === 'POST') equal(url, GRAPHQL_URL);
    return respond(next.status ?? 200, next.text ?? JSON.stringify(next.body ?? null), next.link ?? null);
  };
}

/** Build a fetch boundary that replays a recorded transcript, verifying every request. */
function replayFetch(transcript: RecordedEntry[]): { fetch: FetchLike; done: () => void } {
  let index = 0;
  const replay: FetchLike = async (url, init) => {
    ok(index < transcript.length, `transport requested page ${index + 1} beyond the recorded transcript`);
    const entry = transcript[index];
    index++;
    equal(url, entry.url);
    checkEnvelope(url, init);
    if (entry.query === undefined) {
      equal(init.method, 'GET');
      equal(init.body, null);
    } else {
      equal(init.method, 'POST');
      ok(init.body !== null);
      const sent = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      equal(sent.query, entry.query, 'recorded GraphQL document must match the production query');
      deepEqual(sent.variables, entry.variables, 'recorded variables must match the production request');
    }
    return respond(entry.status, entry.body, entry.link);
  };
  return { fetch: replay, done: () => equal(index, transcript.length, 'recorded transcript was not fully replayed') };
}

/** Build a synthetic transport over a scripted fetch boundary. */
function syntheticTransport(script: Scripted[], extra: { pageSize?: number; timeoutMs?: number } = {}): GitHubTransport {
  return createGitHubTransport({ fetch: scriptFetch(script), token: TOKEN, ...extra });
}

/** Wrap one payload in the standard GraphQL response envelope. */
function gql(data: unknown, errors?: unknown): Scripted {
  return { body: errors === undefined ? { data } : { data, errors } };
}

/** Build one GraphQL connection page. */
function pageOf(nodes: unknown[], hasNextPage = false, endCursor: string | null = null): Record<string, unknown> {
  return { nodes, pageInfo: { hasNextPage, endCursor } };
}

/** Build one pull request page around a single connection. */
function prPage(head: unknown, connection: Record<string, unknown>, author: unknown = { login: 'unbraind' }): unknown {
  return { repository: { pullRequest: { headRefOid: head, author, ...connection } } };
}

/** Build one synthetic threaded comment (thread finding or reply). */
function threadComment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...issueComment(id), originalCommit: { oid: HEAD_B }, ...extra };
}

/** Build one synthetic issue comment. */
function issueComment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, body: `body of ${id}`, url: `https://example.test/${id}`, createdAt: WHEN,
    author: { login: 'unbraind', __typename: 'User' }, reactions: pageOf([]), ...extra,
  };
}

/** Build one synthetic submitted review. */
function review(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, state: 'COMMENTED', body: `body of ${id}`, url: `https://example.test/${id}`, createdAt: WHEN,
    author: { login: 'greptile-apps', __typename: 'Bot' }, commit: { oid: HEAD_B }, reactions: pageOf([]), ...extra,
  };
}

/** Build one synthetic review thread around its comments. */
function thread(id: string, comments: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, isResolved: false, path: `src/${id}.ts`, line: 5, comments: pageOf(comments), ...extra };
}

/** Build one synthetic check suite around its check runs. */
function checkSuite(id: string, runs: Record<string, unknown>[]): Record<string, unknown> {
  return { id, checkRuns: pageOf(runs) };
}

/** Build one synthetic check run. */
function run(name: string, conclusion: string | null, status = 'COMPLETED'): Record<string, unknown> {
  return { name, conclusion, status, databaseId: 1, checkSuite: { app: { id: 'app-one' } } };
}

/** Build one synthetic commit edge. */
function commitEdge(oid: string): Record<string, unknown> {
  return { commit: { oid, committedDate: WHEN, url: `https://example.test/commit/${oid}` } };
}

/** Build one synthetic legacy commit status. */
function statusItem(context: string, state: string): Record<string, unknown> {
  return { context, state, target_url: null };
}

/** Build one synthetic head commit object with its check suites. */
function commitObject(suites: Record<string, unknown>): Record<string, unknown> {
  return { __typename: 'Commit', oid: HEAD_A, committedDate: WHEN, checkSuites: suites };
}

/** Build the expected durable contribution for one synthetic comment or review. */
function expectedContribution(id: string, head: string | null): Contribution {
  return { id, bot: 'unbraind', isBot: false, body: `body of ${id}`, url: `https://example.test/${id}`, createdAt: WHEN, head, reactions: [] };
}

/** Connection keys of one snapshot script, in request order. */
type ScenarioKey = 'threads' | 'reviews' | 'comments' | 'commits' | 'checks' | 'statuses' | 'head';

/** Compose a full single-page snapshot script with empty connections, overridable per connection. */
function scenario(overrides: Partial<Record<ScenarioKey, Scripted | Scripted[]>> = {}): Scripted[] {
  const empty: Record<ScenarioKey, Scripted> = {
    threads: gql(prPage(HEAD_A, { reviewThreads: pageOf([]) })),
    reviews: gql(prPage(HEAD_A, { reviews: pageOf([]) })),
    comments: gql(prPage(HEAD_A, { comments: pageOf([]) })),
    commits: gql(prPage(HEAD_A, { commits: pageOf([]) })),
    checks: gql({ repository: { object: commitObject(pageOf([])) } }),
    statuses: { body: [] },
    head: gql({ repository: { pullRequest: { headRefOid: HEAD_A } } }),
  };
  const script: Scripted[] = [];
  for (const key of ['threads', 'reviews', 'comments', 'commits', 'checks', 'statuses', 'head'] as const) {
    const override = overrides[key];
    if (override === undefined) script.push(empty[key]);
    else if (Array.isArray(override)) script.push(...override);
    else script.push(override);
  }
  return script;
}

/** Assert that one scripted snapshot scenario fails closed with a matching message. */
function snapshotRejects(script: Scripted[], pattern: RegExp): Promise<void> {
  return rejects(syntheticTransport(script).snapshot('synth/repo', 7), pattern);
}

/** Count-indexed arrays for the >100-node pagination scenario. */
function range<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index));
}

/** Deterministic 40-hex synthetic commit id. */
function hexOid(index: number): string {
  return index.toString(16).padStart(40, '0');
}

test('maps a minimal valid pull request', async () => {
  const transport = syntheticTransport([
    gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [threadComment('C_1'), threadComment('C_2', { author: { login: 'unbraind', __typename: 'User' }, originalCommit: null })])]) })),
    gql(prPage(HEAD_A, { reviews: pageOf([review('PRR_1')]) })),
    gql(prPage(HEAD_A, { comments: pageOf([issueComment('IC_1')]) })),
    gql(prPage(HEAD_A, { commits: pageOf([commitEdge(HEAD_B)]) })),
    gql({ repository: { object: commitObject(pageOf([checkSuite('CS_1', [run('build', 'SUCCESS')])])) } }),
    { body: [statusItem('legacy', 'success')] },
    gql({ repository: { pullRequest: { headRefOid: HEAD_A } } }),
  ]);
  const snapshot: PullRequest = await transport.snapshot('synth/repo', 7);
  deepEqual(snapshot, {
    repo: 'synth/repo',
    number: 7,
    head: HEAD_A,
    headDate: WHEN,
    author: 'unbraind',
    threads: [{
      id: 'RT_1',
      path: 'src/RT_1.ts',
      line: 5,
      resolved: false,
      comments: [expectedContribution('C_1', HEAD_B), { ...expectedContribution('C_2', null) }],
    }],
    reviews: [{ ...expectedContribution('PRR_1', HEAD_B), bot: 'greptile-apps', isBot: true, state: 'COMMENTED' }],
    comments: [expectedContribution('IC_1', null)],
    commits: [{ sha: HEAD_B, date: WHEN, url: `https://example.test/commit/${HEAD_B}` }],
    checks: [{ name: 'build', state: 'pass' }, { name: 'legacy', state: 'pass' }],
  });
});

test('pages every connection beyond 100 nodes, including nested replies, reactions and runs', async () => {
  const total = 150;
  const bigReplies = range(total, (index) => threadComment(`R_${index}`, index === 100
    ? { reactions: pageOf(range(100, () => ({ content: 'THUMBS_UP', user: { login: 'unbraind', __typename: 'User' } })), true, 'rx') }
    : {}));
  const bigRuns = range(total, (index) => run(`run-${index}`, index === 149 ? 'FAILURE' : 'SUCCESS'));
  const transport = syntheticTransport([
    gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_big', bigReplies.slice(0, 100), { comments: pageOf(bigReplies.slice(0, 100), true, 'reply-page') }), ...range(99, (index) => thread(`RT_${index}`, []))], true, 't1') })),
    gql(prPage(HEAD_A, { reviewThreads: pageOf(range(50, (index) => thread(`RT_${index + 100}`, []))) })),
    gql({ node: { __typename: 'PullRequestReviewThread', comments: pageOf(bigReplies.slice(100)) } }),
    gql({ node: { __typename: 'PullRequestReviewComment', reactions: pageOf(range(50, () => ({ content: 'THUMBS_UP', user: { login: 'unbraind', __typename: 'User' } }))) } }),
    gql(prPage(HEAD_A, { reviews: pageOf(range(100, (index) => review(`PRR_${index}`)), true, 'rv') })),
    gql(prPage(HEAD_A, { reviews: pageOf(range(50, (index) => review(`PRR_${index + 100}`))) })),
    gql(prPage(HEAD_A, { comments: pageOf(range(100, (index) => issueComment(`IC_${index}`)), true, 'cm') })),
    gql(prPage(HEAD_A, { comments: pageOf(range(50, (index) => issueComment(`IC_${index + 100}`))) })),
    gql(prPage(HEAD_A, { commits: pageOf(range(100, (index) => commitEdge(hexOid(index))), true, 'k1') })),
    gql(prPage(HEAD_A, { commits: pageOf(range(50, (index) => commitEdge(hexOid(index + 100)))) })),
    gql({ repository: { object: commitObject(pageOf([{ id: 'CS_big', checkRuns: pageOf(bigRuns.slice(0, 100), true, 'run-page') }, ...range(99, (index) => checkSuite(`CS_${index}`, [run(`small-${index}`, 'SUCCESS')]))], true, 's1')) } }),
    gql({ repository: { object: commitObject(pageOf(range(50, (index) => checkSuite(`CS_${index + 100}`, [run(`small-${index + 100}`, 'SUCCESS')])))) } }),
    gql({ node: { __typename: 'CheckSuite', checkRuns: pageOf(bigRuns.slice(100)) } }),
    { body: range(100, (index) => statusItem(`legacy-${index}`, 'success')), link: '<https://api.github.com/statuses?per_page=100&page=2>; rel="next"' },
    { body: range(50, (index) => statusItem(`legacy-${index + 100}`, 'success')) },
    gql({ repository: { pullRequest: { headRefOid: HEAD_A } } }),
  ]);
  const snapshot = await transport.snapshot('synth/repo', 7);
  equal(snapshot.threads.length, total);
  equal(snapshot.threads[0].comments.length, total);
  equal(snapshot.threads[0].comments[100].reactions.length, total);
  deepEqual(snapshot.threads[0].comments[100].reactions[0], { content: 'THUMBS_UP', user: 'unbraind' });
  equal(snapshot.threads[0].comments[149].id, 'R_149');
  equal(snapshot.reviews.length, total);
  equal(snapshot.comments.length, total);
  equal(snapshot.commits.length, total);
  equal(snapshot.commits[149].sha, hexOid(149));
  equal(snapshot.checks.length, total * 2 + total - 1);
  equal(snapshot.checks[0].name, 'run-0');
  equal(snapshot.checks[0].state, 'pass');
  equal(snapshot.checks[249].name, 'run-100');
  equal(snapshot.checks[249].state, 'pass');
  equal(snapshot.checks[298].name, 'run-149');
  equal(snapshot.checks[298].state, 'fail');
  equal(snapshot.checks[299].name, 'legacy-0');
  equal(snapshot.checks[448].name, 'legacy-149');
});

test('rejects repositories without an owner and rejects invalid pull request numbers', async () => {
  const transport = syntheticTransport([]);
  await rejects(transport.snapshot('justarepo', 7), /must look like "owner\/repo"/);
  await rejects(transport.snapshot('synth/repo', 0), /positive integer/);
  await rejects(transport.snapshot('synth/repo', 1.5), /positive integer/);
});

test('rejects invalid configured page sizes instead of clamping', () => {
  throws(() => createGitHubTransport({ token: TOKEN, pageSize: 0 }), /pageSize must be an integer between 1 and 100/);
  throws(() => createGitHubTransport({ token: TOKEN, pageSize: 101 }), /pageSize must be an integer between 1 and 100/);
  throws(() => createGitHubTransport({ token: TOKEN, pageSize: 2.5 }), /pageSize must be an integer between 1 and 100/);
});

test('fails closed on unparseable and non-2xx GraphQL responses without leaking bodies', async () => {
  const promise = syntheticTransport([{ text: '{not json' }]).snapshot('synth/repo', 7);
  await rejects(promise, /malformed GitHub response \(JSON body\)/);
  const failing = syntheticTransport([{ status: 500, body: { secrets: 'do-not-leak' } }]).snapshot('synth/repo', 7);
  await rejects(failing, (error: Error) => {
    match(error.message, /GraphQL request failed with HTTP 500/);
    ok(!error.message.includes('do-not-leak'), 'error must not quote response bodies');
    ok(!error.message.includes(TOKEN), 'error must not quote the token');
    return true;
  });
});

test('fails closed on GraphQL error payloads', async () => {
  await snapshotRejects([{ body: { data: null, errors: [{ message: 'Bad credentials' }] } }], /GraphQL reported 1 error\(s\)/);
  await snapshotRejects([{ body: { data: {}, errors: 'boom' } }], /malformed GitHub response \(GraphQL errors\)/);
  await snapshotRejects([{ body: { data: {}, errors: [] } }], /malformed GitHub response \(GraphQL error\)/);
  await snapshotRejects([{ body: { data: null } }], /malformed GitHub response \(GraphQL data\)/);
});

test('fails closed on malformed repository, pull request and author envelopes', async () => {
  const cases: Scripted[][] = [
    [gql({ repository: null })],
    [gql({ repository: { pullRequest: null } })],
    [gql({ repository: { pullRequest: { reviewThreads: pageOf([]) } } })],
    [gql(prPage(42, { reviewThreads: pageOf([]) }))],
    [gql(prPage('not-a-sha', { reviewThreads: pageOf([]) }))],
    [gql(prPage(HEAD_A, { reviewThreads: pageOf([]) }, null))],
    [gql(prPage(HEAD_A, { reviewThreads: pageOf([]) }, { login: 5 }))],
  ];
  const patterns = [
    /\(repository\)/, /\(pullRequest\)/, /\(headRefOid\)/, /\(headRefOid\)/, /\(headRefOid\)/, /\(pullRequest\.author\)/, /\(pullRequest\.author\.login\)/,
  ];
  await Promise.all(cases.map((script, index) => snapshotRejects(script, patterns[index])));
});

test('fails closed on malformed review threads and comments', async () => {
  const malformed = (threads: Record<string, unknown>[]) => scenario({ threads: gql(prPage(HEAD_A, { reviewThreads: pageOf(threads) })) });
  const cases: Scripted[][] = [
    malformed([thread('RT_1', [], { id: undefined })]),
    malformed([thread('RT_1', [], { id: '' })]),
    malformed([thread('RT_1', [], { path: undefined })]),
    malformed([thread('RT_1', [], { line: '5' })]),
    malformed([thread('RT_1', [], { line: 1.5 })]),
    malformed([thread('RT_1', [], { isResolved: 'yes' })]),
    malformed([thread('RT_1', [threadComment('C_1', { id: undefined })])]),
    malformed([thread('RT_1', [threadComment('C_1', { body: 5 })])]),
    malformed([thread('RT_1', [threadComment('C_1', { url: undefined })])]),
    malformed([thread('RT_1', [threadComment('C_1', { createdAt: undefined })])]),
    malformed([thread('RT_1', [threadComment('C_1', { author: undefined })])]),
    malformed([thread('RT_1', [threadComment('C_1', { author: { login: '', __typename: 'User' } })])]),
    malformed([thread('RT_1', [threadComment('C_1', { originalCommit: { oid: 'nope' } })])]),
    malformed([thread('RT_1', [threadComment('C_1', { reactions: {} })])]),
    malformed([thread('RT_1', [threadComment('C_1', { reactions: { nodes: 'x' } })])]),
    malformed([thread('RT_1', [threadComment('C_1', { reactions: { nodes: [] } })])]),
    malformed([thread('RT_1', [threadComment('C_1', { reactions: pageOf([{ content: 'THUMBS_UP', user: { login: '', __typename: 'User' } }]) })])]),
    malformed([thread('RT_1', [threadComment('C_1', { reactions: pageOf([{ content: 5, user: { login: 'x', __typename: 'User' } }]) })])]),
  ];
  const patterns = [
    /\(reviewThread\.id\)/, /\(reviewThread\.id\)/, /\(reviewThread\.path\)/, /\(reviewThread\.line\)/, /\(reviewThread\.line\)/, /\(reviewThread\.isResolved\)/,
    /\(comment\.id\)/, /\(comment\.body\)/, /\(comment\.url\)/, /\(comment\.createdAt\)/, /\(comment\.author\)/, /\(comment\.author\.login\)/,
    /\(comment\.originalCommit\.oid\)/, /\(reactions\.nodes\)/, /\(reactions\.nodes\)/, /\(reactions\.pageInfo\)/, /\(reaction\.user\.login\)/, /\(reaction\.content\)/,
  ];
  await Promise.all(cases.map((script, index) => snapshotRejects(script, patterns[index])));
});

test('fails closed on malformed connection page info', async () => {
  const cases: Scripted[][] = [
    scenario({ threads: gql(prPage(HEAD_A, { reviewThreads: { nodes: [] } })) }),
    scenario({ threads: gql(prPage(HEAD_A, { reviewThreads: { nodes: [], pageInfo: { hasNextPage: 'yes', endCursor: null } } })) }),
    scenario({ threads: gql(prPage(HEAD_A, { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 5 } } })) }),
  ];
  const patterns = [/\(reviewThreads\.pageInfo\)/, /\(reviewThreads\.pageInfo\.hasNextPage\)/, /\(reviewThreads\.pageInfo\.endCursor\)/];
  await Promise.all(cases.map((script, index) => snapshotRejects(script, patterns[index])));
});

test('maps threads without a line and tolerates missing comment heads', async () => {
  const transport = syntheticTransport(scenario({
    threads: gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [threadComment('C_1', { originalCommit: null })], { line: undefined })]) })),
  }));
  const snapshot = await transport.snapshot('synth/repo', 7);
  equal(snapshot.threads[0].line, null);
  equal(snapshot.threads[0].comments[0].head, null);
});

test('fails closed on malformed reviews', async () => {
  const cases: Scripted[][] = [
    scenario({ reviews: gql(prPage(HEAD_A, { reviews: pageOf([review('PRR_1', { state: undefined })]) })) }),
    scenario({ reviews: gql(prPage(HEAD_A, { reviews: pageOf([review('PRR_1', { commit: { oid: 'nope' } })]) })) }),
  ];
  await Promise.all([
    snapshotRejects(cases[0], /\(review\.state\)/),
    snapshotRejects(cases[1], /\(review\.commit\.oid\)/),
  ]);
});

test('fails closed on malformed reply, reaction and run continuations', async () => {
  const threadWithMore = scenario({
    threads: gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [threadComment('C_1')], { comments: pageOf([threadComment('C_1')], true, 'rc') })]) })),
  });
  const suiteWithMore = scenario({
    checks: gql({ repository: { object: commitObject(pageOf([{ id: 'CS_1', checkRuns: pageOf([run('build', 'SUCCESS')], true, 'rn') }])) } }),
  });
  const reactionWithMore = [gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_rx', [threadComment('C_rx', { reactions: pageOf([], true, 'rx') })])]) }))];
  await Promise.all([
    snapshotRejects([...threadWithMore.slice(0, 1), gql({ node: null })], /\(node\)/),
    snapshotRejects([...threadWithMore.slice(0, 1), gql({ node: { __typename: 'Issue', comments: pageOf([]) } })], /\(node\.__typename\)/),
    snapshotRejects([...threadWithMore.slice(0, 1), gql({ node: { __typename: 'PullRequestReviewThread' } })], /\(node\.comments\)/),
    snapshotRejects([...reactionWithMore, reactionScript({ __typename: 'User' })], /\(node\.__typename\)/),
    snapshotRejects([...reactionWithMore, reactionScript({ __typename: 'PullRequestReviewComment' })], /\(node\.reactions\)/),
    snapshotRejects([...reactionWithMore, gql({ node: { __typename: 'PullRequestReviewComment', reactions: pageOf([], true, null) } })], /announced a next page without an end cursor/),
    snapshotRejects(suiteScriptForRuns([...suiteWithMore.slice(0, 5)]), /\(node\.__typename\)/),
    snapshotRejects(suiteScriptForRuns([...suiteWithMore.slice(0, 5), gql({ node: { __typename: 'CheckSuite' } })]), /\(node\.checkRuns\)/),
    snapshotRejects(suiteScriptForRuns([...suiteWithMore.slice(0, 5), gql({ node: { __typename: 'CheckSuite', checkRuns: pageOf([{ name: undefined, conclusion: 'SUCCESS' }]) } })]), /\(checkRun\.name\)/),
  ]);
});

/** Threads page whose single thread announces more replies, used to reach continuation queries. */
function threadScriptWithReplyContinuation(): Scripted[] {
  return [gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [threadComment('C_1')], { comments: pageOf([threadComment('C_1')], true, 'rc') })]) }))];
}

/** Reactions continuation script for the thread with more replies. */
function reactionScript(node: Record<string, unknown>): Scripted {
  return gql({ node });
}

/** Full script through the check suites, so the check-run continuation is reached. */
function suiteScriptForRuns(prefix: Scripted[]): Scripted[] {
  return [...prefix, gql({ node: { __typename: 'Tree' } })];
}

test('maps running checks as pending and fails closed on completed checks without a conclusion', async () => {
  const pending = syntheticTransport(scenario({
    checks: gql({ repository: { object: commitObject(pageOf([checkSuite('CS_1', [run('build', null, 'QUEUED')])])) } }),
  }));
  const snapshot = await pending.snapshot('synth/repo', 7);
  deepEqual(snapshot.checks, [{ name: 'build', state: 'pending' }]);
  await snapshotRejects(scenario({
    checks: gql({ repository: { object: commitObject(pageOf([checkSuite('CS_1', [run('build', null, 'COMPLETED')])])) } }),
  }), /\(checkRun\.conclusion\)/);
  await snapshotRejects(scenario({
    checks: gql({ repository: { object: commitObject(pageOf([checkSuite('CS_1', [run('build', 'WEIRD')])])) } }),
  }), /unclassifiable GitHub check state/);
});

test('fails closed on malformed head commit and check suites', async () => {
  const cases: Scripted[][] = [
    scenario({ checks: gql({ repository: { object: null } }) }),
    scenario({ checks: gql({ repository: { object: { __typename: 'Tree' } } }) }),
    scenario({ checks: gql({ repository: { object: { __typename: 'Commit', oid: HEAD_A, committedDate: WHEN } } }) }),
    scenario({ checks: gql({ repository: { object: { __typename: 'Commit', oid: HEAD_A, committedDate: 5, checkSuites: pageOf([]) } } }) }),
    scenario({ checks: gql({ repository: { object: commitObject(pageOf([{ id: 'CS_1' }])) } }) }),
    scenario({ checks: gql({ repository: { object: commitObject(pageOf([{ id: 'CS_1', checkRuns: pageOf([run('b', 'SUCCESS')], true, null) }])) } }) }),
  ];
  const patterns = [/\(object\)/, /\(object\.__typename\)/, /\(checkSuites\)/, /\(committedDate\)/, /\(checkSuite\.checkRuns\)/, /announced a next page without an end cursor/];
  await Promise.all(cases.map((script, index) => snapshotRejects(script, patterns[index])));
});

test('fails closed on malformed and failing legacy commit status responses', async () => {
  const failing = syntheticTransport(scenario({ statuses: { status: 500, body: { secrets: 'do-not-leak' } } }));
  await rejects(failing.snapshot('synth/repo', 7), (error: Error) => {
    match(error.message, /commit status request failed with HTTP 500/);
    ok(!error.message.includes('do-not-leak'));
    ok(!error.message.includes(TOKEN));
    return true;
  });
  await snapshotRejects(scenario({ statuses: { body: { not: 'an array' } } }), /\(commit statuses body\)/);
  await snapshotRejects(scenario({ statuses: { body: [{ state: 'success' }] } }), /\(commit status\.context\)/);
  await snapshotRejects(scenario({ statuses: { body: [{ context: 'legacy' }] } }), /\(commit status\.state\)/);
  await snapshotRejects(scenario({ statuses: { body: [statusItem('legacy', 'WEIRD')] } }), /unclassifiable GitHub check state/);
});

test('keeps only the newest status per context and stops on empty pages', async () => {
  const deduped = syntheticTransport(scenario({ statuses: { body: [statusItem('legacy', 'success'), statusItem('legacy', 'failure')] } }));
  const snapshot = await deduped.snapshot('synth/repo', 7);
  deepEqual(snapshot.checks, [{ name: 'legacy', state: 'pass' }]);
  const empty = syntheticTransport(scenario({ statuses: { body: [], link: '<https://api.github.com/statuses?page=2>; rel="next"' } }));
  deepEqual((await empty.snapshot('synth/repo', 7)).checks, []);
});

test('fails closed on missing, repeated and cycling status page cursors', async () => {
  const next = (page: number) => `<https://api.github.com/statuses?per_page=100&page=${page}>; rel="next"`;
  await Promise.all([
    snapshotRejects(scenario({ statuses: { body: [statusItem('legacy', 'success')], link: '<https://api.github.com/statuses>; rel="next"' } }), /\(commit status Link header\)/),
    snapshotRejects(scenario({ statuses: { body: [statusItem('legacy', 'success')], link: '<https://api.github.com/statuses?page=abc>; rel="next"' } }), /\(commit status Link header\)/),
    snapshotRejects([
      ...scenario().slice(0, 5),
      { body: [statusItem('legacy', 'success')], link: next(2) },
      { body: [statusItem('other', 'success')], link: next(1) },
    ], /commit status pagination cycled/),
  ]);
});

test('fails closed on missing, repeated and cycling GraphQL cursors', async () => {
  const threadsPage = (endCursor: string | null, hasNext: boolean) => gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [])], hasNext, endCursor) }));
  await Promise.all([
    snapshotRejects([threadsPage(null, true)], /announced a next page without an end cursor/),
    snapshotRejects([threadsPage('c1', true), threadsPage('c1', true)], /cursor repeated or cycled/),
    snapshotRejects([threadsPage('c1', true), threadsPage('c2', true), threadsPage('c1', true)], /cursor repeated or cycled/),
    snapshotRejects(scenario({ threads: gql(prPage(HEAD_A, { reviewThreads: pageOf([thread('RT_1', [threadComment('C_1')], { comments: pageOf([threadComment('C_1')], true, null) })]) })) }), /announced a next page without an end cursor/),
  ]);
});

test('fails closed when the head changes mid-snapshot or after all pages', async () => {
  const threadsPage = (head: string) => gql(prPage(head, { reviewThreads: pageOf([thread('RT_1', [])]) }));
  await Promise.all([
    snapshotRejects([threadsPage(HEAD_A), threadsPage(HEAD_B)], /head changed while snapshotting/),
    snapshotRejects(scenario({ head: gql({ repository: { pullRequest: { headRefOid: HEAD_B } } }) }), /head changed while snapshotting/),
  ]);
});

test('viewer reads the authenticated login and fails closed on malformed viewers', async () => {
  const recorded = loadFixture('viewer.json');
  const replay = replayFetch(recorded.requests);
  const transport = createGitHubTransport({ fetch: replay.fetch, token: TOKEN });
  equal(await transport.viewer(), recorded.login);
  replay.done();
  equal(await syntheticTransport([gql({ viewer: { login: 'pi' } })]).viewer(), 'pi');
  await rejects(syntheticTransport([gql({ viewer: 'x' })]).viewer(), /\(viewer\)/);
  await rejects(syntheticTransport([gql({ viewer: { login: '' } })]).viewer(), /\(viewer\.login\)/);
});

test('thread mutations run only against a synthetic transport and require payloads', async () => {
  const reply = syntheticTransport([{ body: { data: { addPullRequestReviewThreadReply: { clientMutationId: null } } }, match: /addPullRequestReviewThreadReply\(input:\{ pullRequestReviewThreadId:\$thread,body:\$body \}\)/ }]);
  await reply.reply('RT_1', 'done');
  await rejects(syntheticTransport([gql({ addPullRequestReviewThreadReply: null })]).reply('RT_1', 'done'), /\(addPullRequestReviewThreadReply payload\)/);
  await rejects(syntheticTransport([gql(null, [{ message: 'insufficient permission' }])]).reply('RT_1', 'done'), /GraphQL reported 1 error\(s\)/);
  const react = syntheticTransport([{ body: { data: { addReaction: { clientMutationId: null } } }, match: /addReaction\(input:\{ subjectId:\$node,content:\$content \}\).*"content":"THUMBS_DOWN"/s }]);
  await react.react('IC_1', 'THUMBS_DOWN');
  await rejects(syntheticTransport([gql({ addReaction: null })]).react('IC_1', 'THUMBS_UP'), /\(addReaction payload\)/);
  const resolve = syntheticTransport([{ body: { data: { resolveReviewThread: { clientMutationId: null } } }, match: /resolveReviewThread\(input:\{ threadId:\$thread \}\)/ }]);
  await resolve.resolve('RT_1');
  await rejects(syntheticTransport([gql({ resolveReviewThread: null })]).resolve('RT_1'), /\(resolveReviewThread payload\)/);
});

test('bounds every request with the configured timeout', () => {
  const stuck: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
  });
  const transport = createGitHubTransport({ fetch: stuck, token: TOKEN, timeoutMs: 10 });
  return rejects(transport.viewer(), /request timed out/);
});

test('resolves the token from GITHUB_TOKEN, then GH_TOKEN, then gh', () => {
  equal(resolveGitHubToken({ GITHUB_TOKEN: ' t1 ' }, () => null), 't1');
  equal(resolveGitHubToken({ GITHUB_TOKEN: '   ', GH_TOKEN: 't2' }, () => null), 't2');
  equal(resolveGitHubToken({ GH_TOKEN: ' t2 ' }, () => null), 't2');
  equal(resolveGitHubToken({}, () => 'gh-token'), 'gh-token');
  throws(() => resolveGitHubToken({}, () => null), /no GitHub token available/);
  throws(() => resolveGitHubToken({}, () => ''), /no GitHub token available/);
  equal(ghAuthToken(() => '  gh-token  '), 'gh-token');
  equal(ghAuthToken(() => {
    throw new Error('gh missing');
  }), null);
});

test('transports read tokens from the injected environment and gh reader', async () => {
  const fromEnv = syntheticTransport([gql({ viewer: { login: 'pi' } })]);
  equal(await fromEnv.viewer(), 'pi');
  const envTransport = createGitHubTransport({
    fetch: scriptFetch([gql({ viewer: { login: 'pi' } })], 'env-token'),
    env: { GH_TOKEN: 'env-token' },
    ghToken: () => 'gh-token',
  });
  equal(await envTransport.viewer(), 'pi');
  const ghTransport = createGitHubTransport({
    fetch: scriptFetch([gql({ viewer: { login: 'pi' } })], 'gh-token'),
    env: {},
    ghToken: () => 'gh-token',
  });
  await ghTransport.viewer();
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'process-token';
  try {
    const processTransport = createGitHubTransport({ fetch: scriptFetch([gql({ viewer: { login: 'pi' } })], 'process-token') });
    equal(await processTransport.viewer(), 'pi');
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }
});

test('a default transport exposes the full surface without network access', () => {
  const transport = createGitHubTransport({ token: TOKEN });
  equal(typeof transport.snapshot, 'function');
  equal(typeof transport.viewer, 'function');
  equal(typeof transport.reply, 'function');
  equal(typeof transport.react, 'function');
  equal(typeof transport.resolve, 'function');
});

test('classifies bot authors by typename, known login and bot suffix', () => {
  equal(isBotAuthor('Bot', 'anything'), true);
  equal(isBotAuthor('User', 'github-actions'), true);
  equal(isBotAuthor('User', 'coderabbitai'), true);
  equal(isBotAuthor('User', 'app/something[bot]'), true);
  equal(isBotAuthor('User', 'unbraind'), false);
});

test('normalizes every documented check state and fails closed on the rest', () => {
  const outcomes: [string, 'pass' | 'fail' | 'pending'][] = [
    ['success', 'pass'],
    ['FAILURE', 'fail'], ['CANCELLED', 'fail'], ['TIMED_OUT', 'fail'], ['ACTION_REQUIRED', 'fail'], ['error', 'fail'], ['STALE', 'fail'], ['STARTUP_FAILURE', 'fail'],
    ['queued', 'pending'], ['in_progress', 'pending'], ['PENDING', 'pending'], ['expected', 'pending'], ['skipped', 'pending'], ['neutral', 'pending'],
  ];
  for (const [state, expected] of outcomes) equal(checkOutcome(state), expected, state);
  throws(() => checkOutcome('WEIRD'), /unclassifiable GitHub check state/);
});

test('replays the recorded read-only snapshot of public pull request unbraind/pm-rl#68', async () => {
  const recorded = loadFixture('snapshot.json');
  const replay = replayFetch(recorded.requests);
  const transport = createGitHubTransport({ fetch: replay.fetch, token: TOKEN, pageSize: recorded.pageSize });
  const snapshot = await transport.snapshot(recorded.repo, recorded.pr);
  replay.done();
  equal(snapshot.repo, 'unbraind/pm-rl');
  equal(snapshot.number, 68);
  equal(snapshot.head, '14669bcf58229e7226eed958470babc06c88d570');
  equal(snapshot.headDate, '2026-10-12T09:14:08Z');
  equal(snapshot.author, 'unbraind');
  equal(snapshot.threads.length, 12);
  equal(snapshot.reviews.length, 42);
  equal(snapshot.comments.length, 38);
  equal(snapshot.commits.length, 28);
  equal(snapshot.checks.length, 8);
  equal(new Set(snapshot.threads.map((found) => found.id)).size, 12);
  equal(snapshot.commits[27].sha, snapshot.head);
  deepEqual(snapshot.threads[0], {
    id: 'PRRT_kwDOTqJmqs6rNjCa',
    path: 'index.ts',
    line: 3763,
    resolved: true,
    comments: [
      {
        id: 'PRRC_kwDOTqJmqs780XLb',
        bot: 'coderabbitai',
        isBot: true,
        body: snapshot.threads[0].comments[0].body,
        url: 'https://github.com/unbraind/pm-rl/pull/68#discussion_r4241584859',
        createdAt: '2026-10-11T12:35:36Z',
        head: 'c25ff7ea9e84872eb722d3b38502ca5daec885ae',
        reactions: [{ content: 'THUMBS_UP', user: 'unbraind' }],
      },
      {
        id: 'PRRC_kwDOTqJmqs780kg7',
        bot: 'unbraind',
        isBot: false,
        body: snapshot.threads[0].comments[1].body,
        url: 'https://github.com/unbraind/pm-rl/pull/68#discussion_r4241639483',
        createdAt: '2026-10-11T12:53:58Z',
        head: 'c25ff7ea9e84872eb722d3b38502ca5daec885ae',
        reactions: [],
      },
      {
        id: 'PRRC_kwDOTqJmqs780k2s',
        bot: 'coderabbitai',
        isBot: true,
        body: snapshot.threads[0].comments[2].body,
        url: 'https://github.com/unbraind/pm-rl/pull/68#discussion_r4241640876',
        createdAt: '2026-10-11T12:54:24Z',
        head: 'c25ff7ea9e84872eb722d3b38502ca5daec885ae',
        reactions: [{ content: 'THUMBS_UP', user: 'unbraind' }],
      },
    ],
  });
  deepEqual(snapshot.reviews[0], {
    id: 'PRR_kwDOTqJmqs8AAAABRsuK7Q',
    bot: 'greptile-apps',
    isBot: true,
    body: snapshot.reviews[0].body,
    url: 'https://github.com/unbraind/pm-rl/pull/68#pullrequestreview-5482711789',
    createdAt: '2026-10-11T09:14:17Z',
    head: 'c25ff7ea9e84872eb722d3b38502ca5daec885ae',
    reactions: [{ content: 'THUMBS_DOWN', user: 'unbraind' }],
    state: 'COMMENTED',
  });
  deepEqual(snapshot.comments[0], {
    id: 'IC_kwDOTqJmqs8AAAABa_lz_Q',
    bot: 'coderabbitai',
    isBot: true,
    body: snapshot.comments[0].body,
    url: 'https://github.com/unbraind/pm-rl/pull/68#issuecomment-6106477565',
    createdAt: '2026-10-11T07:01:22Z',
    head: null,
    reactions: [{ content: 'THUMBS_UP', user: 'unbraind' }],
  });
  ok(snapshot.comments.every((comment) => comment.head === null), 'issue comments must never claim a head');
  ok(snapshot.checks.some((check) => check.name === 'CodeRabbit' && check.state === 'pass'), 'newest legacy status per context wins');
  ok(snapshot.checks.some((check) => check.name === 'Sourcery review' && check.state === 'pending'), 'skipped runs map to pending');
  ok(snapshot.checks.some((check) => check.name === 'CodeQL' && check.state === 'pass'), 'passing runs map to pass');
});

test('latest retries are selected per GitHub app and name even when older runs arrive last', async () => {
  const newest = { ...run('build', 'SUCCESS'), databaseId: 20 };
  const older = { ...run('build', 'FAILURE'), databaseId: 10 };
  const another = { ...run('build', 'FAILURE'), databaseId: 30, checkSuite: { app: { id: 'app-two' } } };
  const transport = syntheticTransport(scenario({ checks: gql({ repository: { object: commitObject(pageOf([checkSuite('new', [newest]), checkSuite('old', [older]), checkSuite('other', [another])])) } }) }));
  deepEqual((await transport.snapshot('synth/repo', 7)).checks, [{ name: 'build', state: 'pass' }, { name: 'build', state: 'fail' }]);
});
