/** Resolve eligible release review threads without evaluating shell command text. */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isMainInvocation } from './main-invocation.ts';

/** A GitHub CLI result retaining partial query output even when the command fails. */
export interface GitHubResult {
  readonly success: boolean;
  readonly stdout: string;
}

/** A GitHub CLI transport with literal argument boundaries. */
export type GitHubCommand = (args: readonly string[]) => GitHubResult;

/** Run GitHub with literal argument boundaries and suppress best-effort API errors. */
function runGitHub(args: readonly string[]): GitHubResult {
  const result = spawnSync('gh', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { success: result.status === 0, stdout: result.stdout ?? '' };
}

/**
 * Preserve the release loop's selection, serial mutations and best-effort summary writes.
 * Query failures, failed mutations and unavailable summaries leave later merge retries intact.
 */
export function resolveReleaseThreads(owner: string, repo: string, pr: string, summary: string, transport: GitHubCommand = runGitHub): void {
  const unresolved = transport([
    'api', 'graphql',
    '-f', 'query=query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:100){totalCount nodes{author{login __typename}}}}}}}}',
    '-F', `o=${owner}`, '-F', `r=${repo}`, '-F', `n=${pr}`,
    '--jq', `.data.repository.pullRequest.reviewThreads.nodes[]?
      | select(.isResolved==false)
      | select(.comments.totalCount ==
               ([.comments.nodes[]?] | length))
      | select([.comments.nodes[]?.author.__typename]
               | length > 0 and all(. == "Bot"))
      | select([.comments.nodes[]?.author.login]
               | all(. as $l | ["coderabbitai"] | index($l)))
      | .id`,
  ]).stdout;
  for (const threadId of unresolved.split('\n')) {
    if (threadId === '') continue;
    const result = transport([
      'api', 'graphql',
      '-f', 'query=mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}',
      '-F', `t=${threadId}`,
    ]);
    if (!result.success) continue;
    try {
      appendFileSync(summary, `Auto-resolved bot review thread ${threadId} on release PR #${pr}.\n`);
    } catch {
      continue;
    }
  }
}

if (isMainInvocation(process.argv, import.meta.url)) {
  resolveReleaseThreads(process.argv[2], process.argv[3], process.argv[4], process.argv[5]);
}
