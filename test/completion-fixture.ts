import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import type { PullRequest } from '../src/types.ts';

/** Isolate git discovery and replace only the read-only GitHub network boundary. */
export function offlineCompletionHost(t: TestContext, pr: PullRequest): void {
  const originalFetch = globalThis.fetch;
  const previous = { PATH: process.env.PATH, GIT_CEILING_DIRECTORIES: process.env.GIT_CEILING_DIRECTORIES, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.PATH = '';
  process.env.GIT_CEILING_DIRECTORIES = tmpdir();
  process.env.GITHUB_TOKEN = 'synthetic-only-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  /** Every synthetic connection is complete; unexpected operations fail before writes. */
  const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(`https://api.github.com/repos/${pr.repo}/commits/${pr.head}/statuses?`)) return Response.json([{ context: 'CI', state: 'success' }]);
    assert.equal(String(url), 'https://api.github.com/graphql');
    assert.equal(init?.method, 'POST');
    const { query } = JSON.parse(String(init.body)) as { query: string };
    if (query.startsWith('query ViewerLogin')) return Response.json({ data: { viewer: { login: pr.author } } });
    const pull: Record<string, unknown> = { headRefOid: pr.head, author: { login: pr.author } };
    if (query.startsWith('query SnapshotThreads')) pull.reviewThreads = connection([]);
    else if (query.startsWith('query SnapshotReviews')) pull.reviews = connection(pr.reviews.map(review => ({ ...review, author: { login: review.bot, __typename: review.isBot ? 'Bot' : 'User' }, commit: { oid: review.head }, reactions: connection(review.reactions.map(reaction => ({ content: reaction.content, user: { login: reaction.user } }))) })));
    else if (query.startsWith('query SnapshotComments')) pull.comments = connection([]);
    else if (query.startsWith('query SnapshotCommits')) pull.commits = connection(pr.commits.map(commit => ({ commit: { oid: commit.sha, committedDate: commit.date, url: commit.url } })));
    else if (query.startsWith('query SnapshotChecks')) return Response.json({ data: { repository: { object: { __typename: 'Commit', oid: pr.head, committedDate: pr.headDate, checkSuites: connection([]) } } } });
    else assert.ok(query.startsWith('query SnapshotHead'), 'Unexpected synthetic request');
    return Response.json({ data: { repository: { pullRequest: pull } } });
  };
}
