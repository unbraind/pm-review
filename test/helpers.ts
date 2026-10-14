import { PmClient } from '@unbrained/pm-cli/sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Contribution, GitHubTransport, PullRequest } from '../src/types.ts';

/** Construct a real temporary tracker, with cleanup registered before initialization. */
export async function tracker(t: TestContext): Promise<{ client: PmClient; cwd: string; pmRoot: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'pm-review-test-'));
  t.after(async () => { await rm(cwd, { recursive: true, force: true }); });
  const pmRoot = join(cwd, '.agents/pm');
  const client = new PmClient({ cwd, pmRoot, author: 'test-agent', noExtensions: true });
  await client.init('sample', { defaults: true, mergeFence: false, agentGuidance: 'skip' });
  return { client, cwd, pmRoot };
}

/** Synthetic write-test contribution; recorded production reads live in fixtures. */
export function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return { id: 'comment-one', bot: 'coderabbitai[bot]', isBot: true, body: '_⚠️ Potential issue_ | _🟠 Major_\n\n**Validate the input before writing.**', url: 'https://github.com/example/package/pull/1#discussion_r1', createdAt: '2026-10-12T10:00:00Z', head: 'a'.repeat(40), reactions: [{ content: 'THUMBS_UP', user: 'author' }], ...overrides };
}

/** Complete synthetic snapshot for mutations that must never target a real PR. */
export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return { repo: 'example/package', number: 1, head: 'a'.repeat(40), headDate: '2026-10-12T09:00:00Z', author: 'author', threads: [{ id: 'thread-one', path: 'src/input.ts', line: 12, resolved: false, comments: [contribution()] }], reviews: [{ ...contribution({ id: 'review-one', body: 'Review of input validation', reactions: [{ content: 'THUMBS_UP', user: 'author' }] }), state: 'COMMENTED' }], comments: [contribution({ id: 'issue-one', body: 'Full review finished.', head: null })], commits: [{ sha: 'a'.repeat(40), date: '2026-10-12T09:00:00Z', url: 'https://github.com/example/package/commit/' + 'a'.repeat(40) }], checks: [{ name: 'CI', state: 'pass' }], ...overrides };
}

/** In-memory GitHub boundary records only synthetic remote writes and models retries. */
export function syntheticTransport(pr: PullRequest): GitHubTransport & { calls: string[] } {
  const calls: string[] = [];
  return { calls, async lifecycle() { return { merged: false, mergeCommit: null, alerts: [] }; }, async snapshot() { return pr; }, async viewer() { return 'author'; }, async reply(thread, body) { calls.push('reply'); pr.threads.find(item => item.id === thread)!.comments.push(contribution({ id: 'reply-one', bot: 'author', isBot: false, body })); }, async react(node, content) { calls.push(content); const source = pr.threads.flatMap(thread => thread.comments).find(comment => comment.id === node)!; source.reactions.push({ content, user: 'author' }); }, async resolve(thread) { calls.push('resolve'); pr.threads.find(item => item.id === thread)!.resolved = true; } };
}
