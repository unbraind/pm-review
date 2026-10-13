import { createPmCliExpectedError, isPmCliExpectedError, PmClient, printResult, readBooleanOption, readStringOption, suppressHostOutput } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { findingsOf } from './findings.ts';
import { createGitHubTransport } from './github.ts';
import { compactRound, evaluateRound } from './round.ts';
import { importFindings, precedents, reviewItems } from './tracker.ts';
import { decide, parseVerdict } from './verdict.ts';
import type { GitHubTransport } from './types.ts';

/** Validate explicit PR coordinates before reading or mutating either system. */
export function targetOf(options: Record<string, unknown>): { repo: string; pr: number } {
  const repo = readStringOption(options, 'repo') ?? '';
  const number = readStringOption(options, 'pr') ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) throw new Error('--repo owner/name and a positive --pr N are required');
  return { repo, pr: Number(number) };
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
  if (ctx.command === 'review precedents') {
    const scoped = readStringOption(ctx.options, 'repo') !== undefined || readStringOption(ctx.options, 'pr') !== undefined;
    const target = scoped ? targetOf(ctx.options) : undefined;
    const items = await precedents(client, ctx.args[0] ?? '', target?.repo, target?.pr);
    return { query: ctx.args[0], count: items.length, items };
  }
  const target = targetOf(ctx.options);
  if (ctx.command === 'review verdict') {
    const apply = readBooleanOption(ctx.options, 'apply') === true;
    return decide(client, apply ? provided ?? createGitHubTransport() : undefined, { ...target, id: ctx.args[0] ?? '', verdict: parseVerdict(ctx.args[1] ?? ''), reason: readStringOption(ctx.options, 'reason') ?? '', commit: readStringOption(ctx.options, 'commit') ?? '', apply });
  }
  const transport = provided ?? createGitHubTransport();
  const snapshot = await transport.snapshot(target.repo, target.pr);
  if (ctx.command === 'review import') return importFindings(client, snapshot, findingsOf(snapshot));
  if (ctx.command !== 'review round') throw new Error('Unknown pm-review command');
  const result = evaluateRound(snapshot, await reviewItems(client));
  const exit_code = result.complete ? 0 : 1;
  if (readBooleanOption(ctx.options, 'compact') === true && !ctx.global.json) {
    printResult(compactRound(result), ctx.global);
    return { ...suppressHostOutput(result), exit_code };
  }
  return { ...result, exit_code };
}

/** Flags shared by all commands that identify a public or private GitHub PR. */
const TARGET_FLAGS: FlagDefinition[] = [
  { long: '--repo <value>', type: 'string', description: 'Repository owner/name' },
  { long: '--pr <value>', type: 'string', description: 'Positive pull request number' },
];

/** Register help, typed positional arguments and command handlers through the host API. */
export function registerReviewCommands(api: ExtensionApi): void {
  const commands = [
    { name: 'import', description: 'Import every bot thread, review body and issue comment as durable pm context', arguments: [], flags: TARGET_FLAGS, example: 'pm review import --repo unbraind/pm-rl --pr 68' },
    { name: 'verdict', description: 'Record a verdict and reason; apply only when explicitly requested', arguments: [{ name: 'item', required: true, description: 'Imported ReviewFinding item id' }, { name: 'verdict', required: true, description: 'pending|fix|refuse|duplicate|stale|informational' }], flags: [...TARGET_FLAGS, { long: '--reason <value>', type: 'string' as const, description: 'Durable decision reasoning' }, { long: '--commit <value>', type: 'string' as const, description: 'Commit SHA implementing or explaining this decision' }, { long: '--apply', type: 'boolean' as const, description: 'Post a thread reply, vote and resolve; requires write access' }], example: 'pm review verdict sample-gh-abcd refuse --repo unbraind/pm-rl --pr 68 --reason "Existing validation covers this input"' },
    { name: 'round', description: 'Gate the current head on finished review, checks, threads, votes and durable decisions', arguments: [], flags: [...TARGET_FLAGS, { long: '--compact', type: 'boolean' as const, description: 'Emit one host-rendered script line (JSON retains the full receipt)' }], example: 'pm review round --repo unbraind/pm-rl --pr 68 --compact' },
    { name: 'precedents', description: 'Find earlier fix and refuse reasoning across the complete tracker', arguments: [{ name: 'query', required: true, description: 'Words from a finding or its decision' }], flags: TARGET_FLAGS, example: 'pm review precedents "input validation"' },
  ];
  for (const command of commands) {
    api.registerCommand(defineCommand({ name: `review ${command.name}`, description: command.description, intent: 'Project management = context management: retain bot findings and their decisions', arguments: command.arguments, flags: command.flags, examples: [command.example], /** Delegate rendering and exit contracts to the PM host. */ run: (ctx: CommandHandlerContext) => runReviewCommand(ctx) }));
  }
}
