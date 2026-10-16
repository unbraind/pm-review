import { createPmCliExpectedError, isPmCliExpectedError, PmClient, printResult, readBooleanOption, readStringOption, suppressHostOutput } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { findingsOf } from './findings.ts';
import { createGitHubTransport } from './github.ts';
import { compactRound, evaluateRound } from './round.ts';
import { findReviewItems, importFindings, precedents, reviewItems } from './tracker.ts';
import { reconcile } from './reconcile.ts';
import { decide, parseVerdict } from './verdict.ts';
import { respond, reviewStatus } from './respond.ts';
import type { GitHubTransport } from './types.ts';

/** Validate a provided repository filter independently of a pull request number. */
function repositoryOf(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('--repo owner/name and a positive --pr N are required');
  return value;
}

/** Validate a provided pull request filter independently of a repository. */
function pullRequestOf(value: string): number {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('--repo owner/name and a positive --pr N are required');
  return Number(value);
}

/** Validate explicit PR coordinates before reading or mutating either system. */
export function targetOf(options: Record<string, unknown>): { repo: string; pr: number } {
  return { repo: repositoryOf(readStringOption(options, 'repo') ?? ''), pr: pullRequestOf(readStringOption(options, 'pr') ?? '') };
}

/** Dispatch package commands using host workspace coordinates and the injected SDK client. */
export async function runReviewCommand(ctx: CommandHandlerContext, provided?: GitHubTransport): Promise<unknown> {
  try {
    return await dispatchReviewCommand(ctx, provided);
  } catch (failure) {
    // A plain Error leaving an extension handler makes the host report a misleading flag diagnostic; expected errors keep the real validation message.
    throw isPmCliExpectedError(failure) ? failure : createPmCliExpectedError(failure instanceof Error ? failure.message : String(failure));
  }
}

/** Run one dispatched package command; separated so the wrapper above stays the single error boundary. */
async function dispatchReviewCommand(ctx: CommandHandlerContext, provided?: GitHubTransport): Promise<unknown> {
  const client = ctx.sdk?.client ?? new PmClient({ cwd: ctx.source_workspace_root ?? ctx.repo_root, pmRoot: ctx.pm_root, author: ctx.global.author });
  if (ctx.command === 'review find') {
    const items = await findReviewItems(client, readStringOption(ctx.options, 'thread') ?? '');
    return { count: items.length, items };
  }
  if (ctx.command === 'review precedents') {
    const repo = readStringOption(ctx.options, 'repo');
    const pr = readStringOption(ctx.options, 'pr');
    const items = await precedents(client, ctx.args[0] ?? '', repo === undefined ? undefined : repositoryOf(repo), pr === undefined ? undefined : pullRequestOf(pr));
    return { query: ctx.args[0], count: items.length, items };
  }
  const target = targetOf(ctx.options);
  if (ctx.command === 'review verdict') {
    const apply = readBooleanOption(ctx.options, 'apply') === true;
    return decide(client, apply ? provided ?? createGitHubTransport() : undefined, { ...target, id: ctx.args[0] ?? '', verdict: parseVerdict(ctx.args[1] ?? ''), reason: readStringOption(ctx.options, 'reason') ?? '', commit: readStringOption(ctx.options, 'commit') ?? '', apply });
  }
  const transport = provided ?? createGitHubTransport();
  if (ctx.command === 'review respond' || ctx.command === 'review status') {
    const options = { bots: readStringOption(ctx.options, 'bots'), noticePattern: readStringOption(ctx.options, 'noticePattern'), apply: readBooleanOption(ctx.options, 'apply'), resolve: readBooleanOption(ctx.options, 'resolve') };
    return ctx.command === 'review respond' ? respond(client, transport, target.repo, target.pr, options) : reviewStatus(client, transport, target.repo, target.pr, options);
  }
  if (ctx.command === 'review reconcile') return reconcile(client, transport, target.repo, target.pr, readBooleanOption(ctx.options, 'dryRun') === true);
  const snapshot = await transport.snapshot(target.repo, target.pr);
  if (ctx.command === 'review import') return importFindings(client, snapshot, findingsOf(snapshot));
  if (ctx.command !== 'review round') throw new Error('Unknown pm-review command');
  const result = evaluateRound(snapshot, await reviewItems(client));
  const exit = result.complete ? {} : { exit_code: 1 };
  if (readBooleanOption(ctx.options, 'compact') === true && !ctx.global.json) {
    printResult(compactRound(result), ctx.global);
    return { ...suppressHostOutput(result), ...exit };
  }
  return { ...result, ...exit };
}

/** Flags shared by all commands that identify a public or private GitHub PR. */
const TARGET_FLAGS: FlagDefinition[] = [
  { long: '--repo', type: 'string', description: 'Repository owner/name' },
  { long: '--pr', type: 'string', description: 'Positive pull request number' },
];

/** Shared response policy keeps dry-run plans and the merge audit consistent. */
const RESPONSE_FLAGS: FlagDefinition[] = [
  ...TARGET_FLAGS,
  { long: '--bots', type: 'string', description: 'Comma-separated review bot logins replacing defaults; human accounts are excluded' },
  { long: '--notice-pattern', type: 'string', description: 'Additional case-insensitive notice regular expression (downvote)' },
];

/** Register help, typed positional arguments and command handlers through the host API. */
export function registerReviewCommands(api: ExtensionApi): void {
  const commands = [
    { name: 'respond', description: 'Plan recorded inline replies and missing bot votes; dry-run unless --apply', arguments: [], flags: [...RESPONSE_FLAGS, { long: '--apply', type: 'boolean' as const, description: 'Write planned replies and votes to GitHub' }, { long: '--resolve', type: 'boolean' as const, description: 'Also resolve threads with recorded final decisions; default off' }], example: 'pm review respond --repo unbraind/pm-review --pr 1' },
    { name: 'status', description: 'Gate on unanswered findings, missing replies, bot votes, threads and exact-head review', arguments: [], flags: RESPONSE_FLAGS, example: 'pm review status --repo unbraind/pm-review --pr 1' },
    { name: 'reconcile', description: 'Close findings from live resolved threads, terminal alerts and merged PRs (GitHub read-only)', arguments: [], flags: [...TARGET_FLAGS, { long: '--dry-run', type: 'boolean' as const, description: 'Report planned closures without tracker writes' }], example: 'pm review reconcile --repo unbraind/pm-review --pr 1 --dry-run' },
    { name: 'find', description: 'Find imported tracker items by GitHub thread id or review-comment URL', arguments: [], flags: [{ long: '--thread', type: 'string' as const, description: 'PRRT_ thread id or GitHub review-comment URL' }], example: 'pm review find --thread PRRT_example' },
    { name: 'import', description: 'Import every bot thread, review body and issue comment as durable pm context', arguments: [], flags: TARGET_FLAGS, example: 'pm review import --repo unbraind/pm-rl --pr 68' },
    { name: 'verdict', description: 'Record a verdict and reason; apply only when explicitly requested', arguments: [{ name: 'item', required: true, description: 'Imported ReviewFinding item id' }, { name: 'verdict', required: true, description: 'pending|fix|refuse|duplicate|stale|informational' }], flags: [...TARGET_FLAGS, { long: '--reason', type: 'string' as const, description: 'Durable decision reasoning' }, { long: '--commit', type: 'string' as const, description: 'Commit SHA implementing or explaining this decision' }, { long: '--apply', type: 'boolean' as const, description: 'Vote on source content; also reply and resolve threads; requires write access' }], example: 'pm review verdict sample-gh-abcd refuse --repo unbraind/pm-rl --pr 68 --reason "Existing validation covers this input"' },
    { name: 'round', description: 'Gate the current head on finished review, checks, threads, votes and durable decisions', arguments: [], flags: [...TARGET_FLAGS, { long: '--compact', type: 'boolean' as const, description: 'Emit one host-rendered script line (JSON retains the full receipt)' }], example: 'pm review round --repo unbraind/pm-rl --pr 68 --compact' },
    { name: 'precedents', description: 'Find earlier fix and refuse reasoning across the complete tracker', arguments: [{ name: 'query', required: true, description: 'Words from a finding or its decision' }], flags: TARGET_FLAGS, example: 'pm review precedents "input validation"' },
  ];
  for (const command of commands) {
    api.registerCommand(defineCommand({ name: `review ${command.name}`, description: command.description, intent: 'Project management = context management: retain bot findings and their decisions', arguments: command.arguments, flags: command.flags, examples: [command.example], /** Delegate rendering and exit contracts to the PM host. */ run: (ctx: CommandHandlerContext) => runReviewCommand(ctx) }));
  }
}
