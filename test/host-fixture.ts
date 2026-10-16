/** Read-only synthetic GitHub responses preloaded into packed host processes. */
const head = 'a'.repeat(40);
const date = '2026-10-12T09:00:00Z';

/** Wrap synthetic nodes in a complete single-page GitHub connection. */
function connection(nodes: unknown[]): object {
  return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
}

/** Reject every request outside the synthetic read-only snapshot and viewer probes. */
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith(`https://api.github.com/repos/example/package/commits/${head}/statuses?`)) {
    return Response.json([{ context: 'CI', state: 'success' }]);
  }
  if (String(url) !== 'https://api.github.com/graphql' || init?.method !== 'POST') throw new Error('Unexpected synthetic host request');
  if (process.env.PM_REVIEW_HOST_SCENARIO === 'refusal') return Response.json({}, { status: 403 });
  const { query } = JSON.parse(String(init.body)) as { query: string };
  if (query.startsWith('query ViewerLogin')) return Response.json({ data: { viewer: { login: 'author' } } });
  const pull: Record<string, unknown> = { headRefOid: head, author: { login: 'author' } };
  if (query.startsWith('query SnapshotThreads')) pull.reviewThreads = connection([]);
  else if (query.startsWith('query SnapshotReviews')) pull.reviews = connection(process.env.PM_REVIEW_HOST_SCENARIO === 'incomplete' ? [] : [{ id: 'complete', state: 'COMMENTED', body: '', url: 'https://github.com/example/package/pull/1#pullrequestreview-1', createdAt: date, author: { login: 'coderabbitai[bot]', __typename: 'Bot' }, commit: { oid: head }, reactions: connection([]) }]);
  else if (query.startsWith('query SnapshotComments')) pull.comments = connection([]);
  else if (query.startsWith('query SnapshotCommits')) pull.commits = connection([{ commit: { oid: head, committedDate: date, url: `https://github.com/example/package/commit/${head}` } }]);
  else if (query.startsWith('query SnapshotChecks')) return Response.json({ data: { repository: { object: { __typename: 'Commit', oid: head, committedDate: date, checkSuites: connection([]) } } } });
  else if (!query.startsWith('query SnapshotHead')) throw new Error('Unexpected synthetic host query');
  return Response.json({ data: { repository: { pullRequest: pull } } });
};
