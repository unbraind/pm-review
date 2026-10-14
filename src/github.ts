/**
 * The GitHub network boundary of pm-review.
 *
 * Every GitHub operation this package performs — the read-only pull request
 * snapshot, the viewer probe and the three thread mutations — lives in this
 * module. The production GraphQL endpoint is fixed, redirects are refused and
 * every request is bounded by a timeout. Error messages never contain the
 * bearer token, raw response bodies or other response values; malformed
 * responses fail closed by naming only the offending field path. Tests inject
 * a fake fetch boundary to replay recorded fixtures and synthetic scenarios
 * without touching the network.
 */
import { execFileSync } from 'node:child_process';
import type { Check, Commit, Contribution, GitHubTransport, PullRequest, Reaction, Review, ReviewThread, SourceLifecycle } from './types.ts';

/** Fixed production GraphQL endpoint; it is never configurable. */
const GRAPHQL_URL = 'https://api.github.com/graphql';
/** Fixed REST API root; used only for the paginated legacy commit-status list. */
const REST_URL = 'https://api.github.com';
/** Default per-request timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Default GraphQL and REST page size. */
const DEFAULT_PAGE_SIZE = 50;
/** Shape of a commit object id as returned by GitHub. */
const SHA_PATTERN = /^[0-9a-f]{40}$/;
/** Run identity lets the latest retry win without mixing independent GitHub Apps. */
const runIdentities = new WeakMap<Check, { id: number; app: string }>();
/** Known bot logins that GitHub reports with a User __typename. */
const KNOWN_BOT_LOGINS: ReadonlySet<string> = new Set([
  'coderabbitai', 'greptile-apps', 'gemini-code-assist', 'sourcery-ai', 'github-actions',
  'dependabot', 'renovate', 'codecov', 'coveralls', 'imgbot',
]);
/** Check conclusions and commit-status states that count as a hard failure. */
const FAILING_STATES: ReadonlySet<string> = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR', 'STALE', 'STARTUP_FAILURE']);
/** Check conclusions and commit-status states that are expected to settle, or deliberately inert. */
const PENDING_STATES: ReadonlySet<string> = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'EXPECTED', 'SKIPPED', 'NEUTRAL', 'WAITING', 'REQUESTED']);
/** Node __typenames whose reactions connection the reaction continuation query understands. */
const REACTION_TYPENAMES: readonly string[] = ['PullRequestReviewComment', 'IssueComment', 'PullRequestReview'];

/** Page-info fields shared by every paginated connection. */
const PAGE_INFO = 'pageInfo{ hasNextPage endCursor }';
/** Reaction nodes shared by every reactions connection. */
const REACTION_NODES = 'nodes{ content user{ login __typename } }';
/** Author fields shared by every contribution node. */
const AUTHOR = 'author{ login __typename }';
/** First reactions page, embedded in the discovery queries. */
const REACTIONS_FIRST = `reactions(first:$size){ ${PAGE_INFO} ${REACTION_NODES} }`;
/** Follow-up reactions pages, used by the reaction continuation query. */
const REACTIONS_AFTER = `reactions(first:$size,after:$cursor){ ${PAGE_INFO} ${REACTION_NODES} }`;
/** Fields of one threaded review comment (finding or reply). */
const THREAD_COMMENT = `id body url createdAt ${AUTHOR} originalCommit{ oid } ${REACTIONS_FIRST}`;
/** Fields of one issue comment. */
const ISSUE_COMMENT = `id body url createdAt ${AUTHOR} ${REACTIONS_FIRST}`;
/** Fields of one submitted review. */
const REVIEW_FIELDS = `id state body url createdAt ${AUTHOR} commit{ oid } ${REACTIONS_FIRST}`;

/** Pages review threads, including each thread's first page of replies and reactions. */
const THREADS_QUERY = `query SnapshotThreads($owner:String!,$repo:String!,$number:Int!,$size:Int!,$cursor:String){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ headRefOid author{ login } reviewThreads(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ id isResolved path line comments(first:$size){ ${PAGE_INFO} nodes{ ${THREAD_COMMENT} } } } } } } }`;
/** Pages every visible review, including pending objects, with its first reactions page. */
const REVIEWS_QUERY = `query SnapshotReviews($owner:String!,$repo:String!,$number:Int!,$size:Int!,$cursor:String){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ headRefOid reviews(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ ${REVIEW_FIELDS} } } } } }`;
/** Pages issue comments with their first page of reactions. */
const COMMENTS_QUERY = `query SnapshotComments($owner:String!,$repo:String!,$number:Int!,$size:Int!,$cursor:String){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ headRefOid comments(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ ${ISSUE_COMMENT} } } } } }`;
/** Pages the commit history. */
const COMMITS_QUERY = `query SnapshotCommits($owner:String!,$repo:String!,$number:Int!,$size:Int!,$cursor:String){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ headRefOid commits(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ commit{ oid committedDate url } } } } } }`;
/** Pages the check suites of the snapshot head commit, with each suite's first page of check runs. */
const CHECKS_QUERY = `query SnapshotChecks($owner:String!,$repo:String!,$oid:GitObjectID!,$size:Int!,$cursor:String){ repository(owner:$owner,name:$repo){ object(oid:$oid){ __typename ... on Commit{ oid committedDate checkSuites(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ id checkRuns(first:$size){ ${PAGE_INFO} nodes{ name conclusion status databaseId checkSuite{ app{ id } } } } } } } } } }`;
/** Continues the replies of one review thread past its embedded first page. */
const REPLIES_QUERY = `query SnapshotThreadReplies($thread:ID!,$size:Int!,$cursor:String){ node(id:$thread){ __typename ... on PullRequestReviewThread{ comments(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ ${THREAD_COMMENT} } } } } }`;
/** Continues the reactions of one contribution past its embedded first page. */
const REACTIONS_QUERY = `query SnapshotReactions($node:ID!,$size:Int!,$cursor:String){ node(id:$node){ __typename ... on PullRequestReviewComment{ ${REACTIONS_AFTER} } ... on IssueComment{ ${REACTIONS_AFTER} } ... on PullRequestReview{ ${REACTIONS_AFTER} } } } }`;
/** Continues the check runs of one check suite past its embedded first page. */
const RUNS_QUERY = `query SnapshotSuiteRuns($suite:ID!,$size:Int!,$cursor:String){ node(id:$suite){ __typename ... on CheckSuite{ checkRuns(first:$size,after:$cursor){ ${PAGE_INFO} nodes{ name conclusion status databaseId checkSuite{ app{ id } } } } } } }`;
/** Re-reads the head after every page; a mismatch invalidates the whole snapshot. */
const HEAD_QUERY = `query SnapshotHead($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$number){ headRefOid } } }`;
/** Identifies the authenticated account. */
const VIEWER_QUERY = 'query ViewerLogin{ viewer{ login } }';
/** Replies to one review thread; the input field name mirrors the GitHub schema. */
const REPLY_MUTATION = 'mutation ReplyThread($thread:ID!,$body:String!){ addPullRequestReviewThreadReply(input:{ pullRequestReviewThreadId:$thread,body:$body }){ clientMutationId } }';
/** Adds one reaction to any reactable node. */
const REACT_MUTATION = 'mutation React($node:ID!,$content:ReactionContent!){ addReaction(input:{ subjectId:$node,content:$content }){ clientMutationId } }';
/** Resolves one review thread. */
const RESOLVE_MUTATION = 'mutation ResolveThread($thread:ID!){ resolveReviewThread(input:{ threadId:$thread }){ clientMutationId } }';

/** Request shape handed to the fetch boundary; mirrors the fetch subset used here. */
export interface TransportRequestInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string | null;
  redirect: 'error';
  signal: AbortSignal;
}

/** Response shape read back from the fetch boundary. */
export interface TransportResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch boundary; the global fetch satisfies it directly. */
export type FetchLike = (url: string, init: TransportRequestInit) => Promise<TransportResponse>;

/** Environment tokens consulted for authentication, in resolution order. */
export interface TokenEnv {
  GITHUB_TOKEN?: string | undefined;
  GH_TOKEN?: string | undefined;
}

/** Runs a command and captures its stdout, matching the execFileSync subset used here. */
export type CommandRunner = (file: string, args: string[], options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore'] }) => string;

/** Options accepted by {@link createGitHubTransport}. */
export interface GitHubTransportOptions {
  /** Fetch boundary used for every request; defaults to the global fetch. */
  fetch?: FetchLike;
  /** Explicit bearer token; skips environment and gh resolution. */
  token?: string;
  /** Environment consulted for GITHUB_TOKEN and GH_TOKEN; defaults to process.env. */
  env?: TokenEnv;
  /** Reads the token from the gh CLI; defaults to a real `gh auth token` invocation. */
  ghToken?: () => string | null;
  /** Per-request timeout in milliseconds; defaults to 15000. */
  timeoutMs?: number;
  /** Requested page size between 1 and 100, capped at 50 to bound nested query cost; defaults to 50. Small values exist so recorded fixtures exercise pagination. */
  pageSize?: number;
}

/** One validated page of a GraphQL connection. */
interface FetchedPage {
  nodes: unknown[];
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Deferred continuation of one review thread's replies past the embedded first page. */
interface RepliesTask { kind: 'replies'; threadId: string; comments: Contribution[]; cursor: string }
/** Deferred continuation of one contribution's reactions past the embedded first page. */
interface ReactionsTask { kind: 'reactions'; nodeId: string; reactions: Reaction[]; cursor: string }
/** Deferred continuation of one check suite's check runs past the embedded first page. */
interface RunsTask { kind: 'runs'; suiteId: string; checks: Check[]; cursor: string }
/** Any nested-connection continuation discovered while mapping a page. */
type ContinuationTask = RepliesTask | ReactionsTask | RunsTask;

/**
 * Build the GitHub transport: the single network boundary of this package.
 *
 * The returned transport snapshots a pull request read-only and exposes the
 * viewer probe plus the three thread mutations. Nothing else in the package
 * performs network I/O, so tests inject a fetch boundary (and, where needed,
 * token sources) instead of mocking any SDK.
 */
export function createGitHubTransport(options: GitHubTransportOptions = {}): GitHubTransport {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const ghToken = options.ghToken ?? ghAuthToken;
  const token = options.token ?? resolveGitHubToken(env, ghToken);
  const pageSize = Math.min(validPageSize(options.pageSize ?? DEFAULT_PAGE_SIZE), 50);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Send one request; redirects are refused and every request is timeout bounded. */
  const send = (url: string, method: 'GET' | 'POST', headers: Record<string, string>, body: string | null): Promise<TransportResponse> =>
    fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...headers },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });

  /** Post one GraphQL document and return its validated `data` object. */
  const graphql = async (query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const response = await send(GRAPHQL_URL, 'POST', { accept: 'application/vnd.github+json', 'content-type': 'application/json' }, JSON.stringify({ query, variables }));
    if (!response.ok) throw new Error(`github transport: GraphQL request failed with HTTP ${response.status}`);
    const root = obj(parseJson(await response.text()), 'GraphQL response');
    const errors = root.errors;
    if (errors) {
      if (!Array.isArray(errors)) malformed('GraphQL errors');
      obj(errors[0], 'GraphQL error');
      throw new Error(`github transport: GraphQL reported ${errors.length} error(s)`);
    }
    return obj(root.data, 'GraphQL data');
  };

  /** Run one mutation and require a non-null payload so silent no-ops fail closed. */
  const mutate = async (name: string, query: string, variables: Record<string, unknown>): Promise<void> => {
    const data = await graphql(query, variables);
    obj(data[name], `${name} payload`);
  };

  /** Read the login of the authenticated account. */
  const viewer = async (): Promise<string> => {
    const data = await graphql(VIEWER_QUERY, {});
    return str(obj(data.viewer, 'viewer').login, 'viewer.login');
  };

  /** Reply to one review thread; only ever exercised against a synthetic transport in tests. */
  const reply = (thread: string, body: string): Promise<void> =>
    mutate('addPullRequestReviewThreadReply', REPLY_MUTATION, { thread, body });

  /** Add one thumbs-up or thumbs-down reaction to any reactable node. */
  const react = (node: string, content: 'THUMBS_UP' | 'THUMBS_DOWN'): Promise<void> =>
    mutate('addReaction', REACT_MUTATION, { node, content });

  /** Resolve one review thread. */
  const resolve = (thread: string): Promise<void> =>
    mutate('resolveReviewThread', RESOLVE_MUTATION, { thread });

  /** Snapshot one pull request; rejects truncation, mutation and stale heads. */
  const snapshot = async (repo: string, pr: number): Promise<PullRequest> => {
    const [owner, name] = parseRepo(repo);
    if (!Number.isInteger(pr) || pr <= 0) throw new Error('github transport: pull request number must be a positive integer');
    const threads: ReviewThread[] = [];
    const reviews: Review[] = [];
    const issueComments: Contribution[] = [];
    const commits: Commit[] = [];
    const checks: Check[] = [];
    const queue: ContinuationTask[] = [];
    let head: string | undefined;
    let author: string | undefined;
    let headDate: string | undefined;

    /** Validate the repository and pull request envelope of one fetched page. */
    const pullRequestOf = (data: Record<string, unknown>): Record<string, unknown> => {
      const repository = obj(data.repository, 'repository');
      const pull = obj(repository.pullRequest, 'pullRequest');
      const current = sha(pull.headRefOid, 'headRefOid');
      if (head === undefined) {
        head = current;
        author = str(obj(pull.author, 'pullRequest.author').login, 'pullRequest.author.login');
      } else if (head !== current) {
        throw new Error('github transport: pull request head changed while snapshotting');
      }
      return pull;
    };

    /** Page one top-level pull request connection, mapping nodes as they arrive. */
    const pagePullRequest = async (query: string, field: string, collect: (node: unknown) => void): Promise<void> => {
      await eachPage(async (cursor) => {
        const data = await graphql(query, { owner, repo: name, number: pr, size: pageSize, cursor });
        const pull = pullRequestOf(data);
        const page = connection(pull[field], field);
        for (const node of page.nodes) collect(node);
        return page;
      });
    };

    /** Fetch one further page of replies for one review thread. */
    const fetchReplies = async (task: RepliesTask, cursor: string | null): Promise<FetchedPage> => {
      const data = await graphql(REPLIES_QUERY, { thread: task.threadId, size: pageSize, cursor });
      const node = obj(data.node, 'node');
      if (node.__typename !== 'PullRequestReviewThread') malformed('node.__typename');
      const page = connection(node.comments, 'node.comments');
      for (const rawNode of page.nodes) task.comments.push(mapContribution(rawNode, queue, 'threaded', 'reply'));
      return page;
    };

    /** Fetch one further page of reactions for one contribution. */
    const fetchReactions = async (task: ReactionsTask, cursor: string | null): Promise<FetchedPage> => {
      const data = await graphql(REACTIONS_QUERY, { node: task.nodeId, size: pageSize, cursor });
      const node = obj(data.node, 'node');
      if (!REACTION_TYPENAMES.includes(str(node.__typename, 'node.__typename'))) malformed('node.__typename');
      const page = connection(node.reactions, 'node.reactions');
      task.reactions.push(...mapReactions(page.nodes));
      return page;
    };

    /** Fetch one further page of check runs for one check suite. */
    const fetchRuns = async (task: RunsTask, cursor: string | null): Promise<FetchedPage> => {
      const data = await graphql(RUNS_QUERY, { suite: task.suiteId, size: pageSize, cursor });
      const node = obj(data.node, 'node');
      if (node.__typename !== 'CheckSuite') malformed('node.__typename');
      const page = connection(node.checkRuns, 'node.checkRuns');
      for (const rawNode of page.nodes) task.checks.push(mapCheckRun(rawNode));
      return page;
    };

    let drained = 0;
    /** Drain pending nested continuations (replies, reactions, check runs) in discovery order, consuming each task once. */
    const drain = async (): Promise<void> => {
      while (drained < queue.length) {
        const task = queue[drained];
        drained++;
        if (task.kind === 'replies') await eachPage((cursor) => fetchReplies(task, cursor), task.cursor);
        else if (task.kind === 'reactions') await eachPage((cursor) => fetchReactions(task, cursor), task.cursor);
        else await eachPage((cursor) => fetchRuns(task, cursor), task.cursor);
      }
    };

    /** Page the legacy commit-status list of the snapshot head; the newest status per context wins. */
    const collectStatuses = async (): Promise<void> => {
      const contexts = new Set<string>();
      const url = `${REST_URL}/repos/${owner}/${name}/commits/${head!}/statuses`;
      let page = 1;
      for (;;) {
        const response = await send(`${url}?per_page=${pageSize}&page=${page}`, 'GET', { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, null);
        if (!response.ok) throw new Error(`github transport: commit status request failed with HTTP ${response.status}`);
        const statuses = parseJson(await response.text());
        if (!Array.isArray(statuses)) malformed('commit statuses body');
        for (const rawStatus of statuses) {
          const raw = obj(rawStatus, 'commit status');
          const context = str(raw.context, 'commit status.context');
          if (contexts.has(context)) continue;
          contexts.add(context);
          checks.push({ name: context, state: checkOutcome(str(raw.state, 'commit status.state')) });
        }
        if (statuses.length === 0) return;
        const next = nextStatusesPage(response.headers.get('link'), page);
        if (next === null) return;
        page = next;
      }
    };

    await pagePullRequest(THREADS_QUERY, 'reviewThreads', (node) => threads.push(mapThread(node, queue)));
    await drain();
    await pagePullRequest(REVIEWS_QUERY, 'reviews', (node) => reviews.push(mapReview(node, queue)));
    await drain();
    await pagePullRequest(COMMENTS_QUERY, 'comments', (node) => issueComments.push(mapContribution(node, queue, 'issue', 'issueComment')));
    await drain();
    await pagePullRequest(COMMITS_QUERY, 'commits', (node) => commits.push(mapCommit(node)));
    await drain();

    await eachPage(async (cursor) => {
      const data = await graphql(CHECKS_QUERY, { owner, repo: name, oid: head!, size: pageSize, cursor });
      const repository = obj(data.repository, 'repository');
      const object = obj(repository.object, 'object');
      if (object.__typename !== 'Commit') malformed('object.__typename');
      headDate = str(object.committedDate, 'committedDate');
      const page = connection(object.checkSuites, 'checkSuites');
      for (const node of page.nodes) collectSuite(node, queue, checks);
      return page;
    });
    await drain();
    await collectStatuses();

    const data = await graphql(HEAD_QUERY, { owner, repo: name, number: pr });
    const repository = obj(data.repository, 'repository');
    const pull = obj(repository.pullRequest, 'pullRequest');
    if (sha(pull.headRefOid, 'headRefOid') !== head) throw new Error('github transport: pull request head changed while snapshotting');
    // The first page of each connection always executes, so these are guaranteed to be set.
    return { repo, number: pr, head: head!, headDate: headDate!, author: author!, threads, reviews, comments: issueComments, commits, checks: latestChecks(checks) };
  };

  /** Read a validated REST object without exposing response values in errors. */
  const restObject = async (path: string): Promise<Record<string, unknown>> => {
    const response = await send(`${REST_URL}/repos/${path}`, 'GET', { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }, null);
    if (!response.ok) throw new Error(`github transport: lifecycle request failed with HTTP ${response.status}`);
    return obj(parseJson(await response.text()), 'lifecycle');
  };

  /** Read merge and individually linked code-scanning alert states, never mutating GitHub. */
  const lifecycle = async (repo: string, pr: number, alerts: number[]): Promise<SourceLifecycle> => {
    parseRepo(repo);
    if (!Number.isSafeInteger(pr) || pr <= 0 || alerts.some(number => !Number.isSafeInteger(number) || number <= 0)) throw new Error('github transport: positive source numbers required');
    const pull = await restObject(`${repo}/pulls/${pr}`);
    const result: SourceLifecycle = { merged: flag(pull.merged, 'merged'), mergeCommit: optional(pull.merge_commit_sha, sha, 'merge_commit_sha'), alerts: [] };
    for (const number of [...new Set(alerts)].sort((left, right) => left - right)) {
      const alert = await restObject(`${repo}/code-scanning/alerts/${number}`);
      const state = alert.state === null ? null : str(alert.state, 'alert.state');
      if (state !== null && state !== 'open' && state !== 'fixed' && state !== 'dismissed') malformed('alert.state');
      result.alerts.push({ number, state: state ?? 'unknown' });
    }
    return result;
  };

  return { snapshot, lifecycle, viewer, reply, react, resolve };
}

/** Split an "owner/repo" identifier, rejecting anything else. */
function parseRepo(repo: string): [string, string] {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo);
  if (match === null) throw new Error('github transport: repository must look like "owner/repo"');
  return [match[1], match[2]];
}

/** Validate the configured page size; fail closed instead of silently clamping. */
function validPageSize(size: number): number {
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('github transport: pageSize must be an integer between 1 and 100');
  return size;
}

/** Read the GitHub token from the gh CLI; returns null when gh is missing or fails. */
export function ghAuthToken(run: CommandRunner = execFileSync): string | null {
  try {
    return run('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Read one optional environment token, treating blank values as unset. */
function readEnvToken(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

/** Resolve the bearer token: GITHUB_TOKEN, then GH_TOKEN, then the gh CLI; fails when nothing yields one. */
export function resolveGitHubToken(env: TokenEnv, ghToken: () => string | null): string {
  const fromEnv = readEnvToken(env.GITHUB_TOKEN) ?? readEnvToken(env.GH_TOKEN);
  if (fromEnv !== null) return fromEnv;
  const fromGh = ghToken();
  if (fromGh === null || fromGh === '') throw new Error('github transport: no GitHub token available; set GITHUB_TOKEN or GH_TOKEN or run `gh auth login`');
  return fromGh;
}

/**
 * Classify one contribution author as a bot account.
 *
 * GitHub Apps report a Bot __typename, but well-known service accounts such
 * as github-actions authenticate as plain users, and app bots carry a
 * "[bot]" login suffix.
 */
export function isBotAuthor(typename: string, login: string): boolean {
  if (typename === 'Bot') return true;
  if (KNOWN_BOT_LOGINS.has(login)) return true;
  return login.endsWith('[bot]');
}

/** Check conclusions and commit-status states that are still expected to settle, or deliberately inert. */
export function checkOutcome(state: string): Check['state'] {
  const normalized = state.trim().toUpperCase();
  if (normalized === 'SUCCESS') return 'pass';
  if (FAILING_STATES.has(normalized)) return 'fail';
  if (PENDING_STATES.has(normalized)) return 'pending';
  throw new Error('github transport: unclassifiable GitHub check state');
}

/** Derive the gate outcome of one check run from its conclusion or, while running, its status. */
function checkRunOutcome(raw: Record<string, unknown>): Check['state'] {
  const conclusion = optional(raw.conclusion, str, 'checkRun.conclusion');
  if (conclusion !== null) return checkOutcome(conclusion);
  const status = str(raw.status, 'checkRun.status');
  if (status === 'COMPLETED') malformed('checkRun.conclusion');
  return checkOutcome(status);
}

/** Extract the next commit-status page number from a Link header, failing closed on cycles. */
function nextStatusesPage(linkHeader: string | null, currentPage: number): number | null {
  if (linkHeader === null) return null;
  const match = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
  if (match === null) return null;
  const url = new URL(match[1], REST_URL);
  const pageParam = url.searchParams.get('page');
  if (pageParam === null) malformed('commit status Link header');
  const requested = Number(pageParam);
  if (!Number.isInteger(requested)) malformed('commit status Link header');
  if (requested <= currentPage) throw new Error('github transport: commit status pagination cycled');
  return requested;
}

/** Throw the canonical malformed-response error, naming only the field path and never its value. */
function malformed(field: string): never {
  throw new Error(`github transport: malformed GitHub response (${field})`);
}

/** Parse one response body as JSON; unparseable payloads fail closed. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    malformed('JSON body');
  }
}

/** Require a string field; empty strings are rejected. */
function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') return malformed(field);
  return value;
}

/** Require a string field that may legitimately be an empty comment body. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') return malformed(field);
  return value;
}

/** Require a boolean field. */
function flag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return malformed(field);
  return value;
}

/** Require an integer field, such as a thread line number. */
function int(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return malformed(field);
  return value;
}

/** Require a non-null object field. */
function obj(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return malformed(field);
  return value as Record<string, unknown>;
}

/** Require a string field shaped like a commit object id. */
function sha(value: unknown, field: string): string {
  const id = str(value, field);
  if (!SHA_PATTERN.test(id)) return malformed(field);
  return id;
}

/** Map an absent or null GraphQL field to null; other values go through the reader. */
function optional<T>(value: unknown, read: (value: unknown, field: string) => T, field: string): T | null {
  if (value === null || value === undefined) return null;
  return read(value, field);
}

/** Read the object id of one present commit object. */
function commitOid(value: unknown, field: string): string {
  return sha(obj(value, field).oid, `${field}.oid`);
}

/** Require the end cursor of a page that announced a further page. */
function requireCursor(endCursor: string | null): string {
  if (endCursor === null) throw new Error('github transport: pagination announced a next page without an end cursor');
  return endCursor;
}

/** Extract and validate one connection object from a GraphQL payload. */
function connection(value: unknown, field: string): FetchedPage {
  const raw = obj(value, field);
  const nodes = raw.nodes;
  if (!Array.isArray(nodes)) malformed(`${field}.nodes`);
  return {
    nodes,
    hasNextPage: flag(obj(raw.pageInfo, `${field}.pageInfo`).hasNextPage, `${field}.pageInfo.hasNextPage`),
    endCursor: optional(obj(raw.pageInfo, `${field}.pageInfo`).endCursor, str, `${field}.pageInfo.endCursor`),
  };
}

/** Page one GraphQL connection to completion, failing closed on missing, repeated or cycling cursors. */
async function eachPage(fetchPage: (cursor: string | null) => Promise<FetchedPage>, initialCursor: string | null = null): Promise<void> {
  const seen = new Set<string>(initialCursor === null ? [] : [initialCursor]);
  let cursor = initialCursor;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page.hasNextPage) return;
    const next = requireCursor(page.endCursor);
    if (seen.has(next)) throw new Error('github transport: pagination cursor repeated or cycled');
    seen.add(next);
    cursor = next;
  }
}

/** Map raw reaction nodes to durable reactions. */
function mapReactions(nodes: unknown[]): Reaction[] {
  return nodes.map((rawNode) => {
    const raw = obj(rawNode, 'reaction');
    return { content: str(raw.content, 'reaction.content'), user: str(obj(raw.user, 'reaction.user').login, 'reaction.user.login') };
  });
}

/** Read and classify one raw contribution author. */
function readAuthor(raw: Record<string, unknown>, field: string): { login: string; isBot: boolean } {
  const actor = obj(raw.author, `${field}.author`);
  const login = str(actor.login, `${field}.author.login`);
  const typename = str(actor.__typename, `${field}.author.__typename`);
  return { login, isBot: isBotAuthor(typename, login) };
}

/** Absorb the first reaction page of one contribution and queue the remaining pages. */
function queueReactions(rawReactions: unknown, contribution: Contribution, queue: ContinuationTask[]): void {
  const reactions = connection(rawReactions, 'reactions');
  contribution.reactions.push(...mapReactions(reactions.nodes));
  if (reactions.hasNextPage) {
    queue.push({ kind: 'reactions', nodeId: contribution.id, reactions: contribution.reactions, cursor: requireCursor(reactions.endCursor) });
  }
}

/** Map one raw comment-shaped node (thread comment, reply or issue comment) into a durable contribution. */
function mapContribution(rawNode: unknown, queue: ContinuationTask[], origin: 'threaded' | 'issue', field: string): Contribution {
  const raw = obj(rawNode, field);
  const author = readAuthor(raw, field);
  const contribution: Contribution = {
    id: str(raw.id, `${field}.id`),
    bot: author.login,
    isBot: author.isBot,
    body: text(raw.body, `${field}.body`),
    url: str(raw.url, `${field}.url`),
    createdAt: str(raw.createdAt, `${field}.createdAt`),
    head: origin === 'threaded' ? optional(raw.originalCommit, commitOid, `${field}.originalCommit`) : null,
    reactions: [],
  };
  queueReactions(raw.reactions, contribution, queue);
  return contribution;
}

/** Map one raw review thread into its durable form, queueing nested continuations. */
function mapThread(rawNode: unknown, queue: ContinuationTask[]): ReviewThread {
  const raw = obj(rawNode, 'reviewThread');
  const thread: ReviewThread = {
    id: str(raw.id, 'reviewThread.id'),
    path: str(raw.path, 'reviewThread.path'),
    line: optional(raw.line, int, 'reviewThread.line'),
    resolved: flag(raw.isResolved, 'reviewThread.isResolved'),
    comments: [],
  };
  const replies = connection(raw.comments, 'reviewThread.comments');
  for (const node of replies.nodes) thread.comments.push(mapContribution(node, queue, 'threaded', 'comment'));
  if (replies.hasNextPage) {
    queue.push({ kind: 'replies', threadId: thread.id, comments: thread.comments, cursor: requireCursor(replies.endCursor) });
  }
  return thread;
}

/** Map one raw submitted review into its durable form, queueing reaction continuations. */
function mapReview(rawNode: unknown, queue: ContinuationTask[]): Review {
  const raw = obj(rawNode, 'review');
  const author = readAuthor(raw, 'review');
  const review: Review = {
    id: str(raw.id, 'review.id'),
    bot: author.login,
    isBot: author.isBot,
    body: text(raw.body, 'review.body'),
    url: str(raw.url, 'review.url'),
    createdAt: str(raw.createdAt, 'review.createdAt'),
    head: optional(raw.commit, commitOid, 'review.commit'),
    reactions: [],
    state: str(raw.state, 'review.state'),
  };
  queueReactions(raw.reactions, review, queue);
  return review;
}

/** Map one raw check run into its durable form. */
function mapCheckRun(rawNode: unknown): Check {
  const raw = obj(rawNode, 'checkRun');
  const check = { name: str(raw.name, 'checkRun.name'), state: checkRunOutcome(raw) };
  const app = obj(obj(raw.checkSuite, 'checkRun.checkSuite').app, 'checkRun.app');
  runIdentities.set(check, { id: int(raw.databaseId, 'checkRun.databaseId'), app: str(app.id, 'checkRun.app.id') });
  return check;
}

/** Map one raw pull request commit edge into the durable commit list. */
function mapCommit(rawNode: unknown): Commit {
  const edge = obj(rawNode, 'commit edge');
  const raw = obj(edge.commit, 'commit');
  return { sha: sha(raw.oid, 'commit.oid'), date: str(raw.committedDate, 'commit.committedDate'), url: str(raw.url, 'commit.url') };
}

/** Absorb one check suite's first page of check runs and queue the remaining runs. */
function collectSuite(rawNode: unknown, queue: ContinuationTask[], checks: Check[]): void {
  const raw = obj(rawNode, 'checkSuite');
  const runs = connection(raw.checkRuns, 'checkSuite.checkRuns');
  for (const node of runs.nodes) checks.push(mapCheckRun(node));
  if (runs.hasNextPage) {
    queue.push({ kind: 'runs', suiteId: str(raw.id, 'checkSuite.id'), checks, cursor: requireCursor(runs.endCursor) });
  }
}
/** Retain the newest check run per app/name, while legacy contexts keep their transport-side order. */
function latestChecks(checks: Check[]): Check[] {
  const latest = new Map<string, Check>();
  for (const check of checks) {
    const identity = runIdentities.get(check);
    const key = identity ? `${identity.app}/${check.name}` : `status/${check.name}`;
    const prior = latest.get(key);
    if (!prior || !identity || identity.id > runIdentities.get(prior)!.id) latest.set(key, check);
  }
  return [...latest.values()];
}
