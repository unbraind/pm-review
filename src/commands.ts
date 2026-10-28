import { reviewScopeFile } from './scope-file.ts';
import { reviewConflicts } from './conflicts.ts';
import { serializeConflictWitness } from './conflict-state.ts';
import { reviewEvidenceRequestsFile } from './requests.ts';
import { serializeEvidenceRequests } from './output-budget.ts';
import { importReviewArtifact } from './envelope-artifact.ts';
import { createPmCliExpectedError, isPmCliExpectedError, PmClient, printResult, readBooleanOption, readStringOption, suppressHostOutput, writeStdout } from '@unbrained/pm-cli/sdk';
import { defineCommand } from '@unbrained/pm-cli/sdk/authoring';
import type { CommandHandlerContext, ExtensionApi, FlagDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { findingLineage } from './lineage.ts';
import { coverCriterion, reviewCoverage } from './coverage.ts';
import type { CoverOptions } from './coverage-types.ts';
import { reviewCloseout } from './closeout.ts';
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
  if (ctx.command === 'review conflicts') {
    const result = await reviewConflicts(client, { schema: 'review-conflicts/v1', item: ctx.args[0] ?? '', revision: ctx.options.revision ?? '' });
    const format = ctx.global.json ? 'json' : ctx.global.outputFormat ?? ctx.global.defaultOutputFormat ?? 'toon';
    if (!ctx.global.quiet) writeStdout(serializeConflictWitness(result, format));
    return { ...suppressHostOutput(result), ...(result.ok ? {} : { exit_code: 1 }) };
  }
  if (ctx.command === 'review requests') {
    const format = ctx.global.json ? 'json' : ctx.global.outputFormat ?? ctx.global.defaultOutputFormat ?? 'toon';
    const result = await reviewEvidenceRequestsFile(client, readStringOption(ctx.options, 'file') ?? '', format);
    if (!ctx.global.quiet) writeStdout(serializeEvidenceRequests(result, format));
    return { ...suppressHostOutput(result), ...(result.ok ? {} : { exit_code: 1 }) };
  }
  if (ctx.command === 'review scope' || ctx.command === 'review carry-forward') {
    const result = await reviewScopeFile(client, ctx.args[0] ?? '', readStringOption(ctx.options, 'file') ?? '', ctx.command === 'review scope');
    return result.ok ? result : { ...result, exit_code: 1 };
  }
  if (ctx.command === 'review ingest') {
    const result = await importReviewArtifact(client, { file: readStringOption(ctx.options, 'file'), url: readStringOption(ctx.options, 'url'), sha256: readStringOption(ctx.options, 'sha256') ?? '' });
    return result.ok ? result : { ...result, exit_code: 1 };
  }
  if (ctx.command === 'review lineage') {
    const result = await findingLineage(client, ctx.args[0] ?? '', { with: readStringOption(ctx.options, 'with'), confirm: readBooleanOption(ctx.options, 'confirm'), revision: readStringOption(ctx.options, 'revision'), reason: readStringOption(ctx.options, 'reason') });
    return result.ok ? result : { ...result, exit_code: 1 };
  }
  if (ctx.command === 'review coverage' || ctx.command === 'review cover') {
    const id = ctx.args[0] ?? '';
    const options = { author: ctx.global.author ?? process.env.PM_AUTHOR, ...Object.fromEntries(['revision', 'criterion', 'evidence', 'excerpt', 'reason', 'judgment'].map(/** Preserve invalid inputs for typed validation instead of guessing a judgment. */ name => [name, readStringOption(ctx.options, name) ?? ''])) } as unknown as CoverOptions;
    const result = ctx.command === 'review coverage' ? await reviewCoverage(client, id) : await coverCriterion(client, id, options);
    return result.ok ? result : { ...result, exit_code: 1 };
  }
  if (ctx.command === 'review closeout') {
    const timeout = readStringOption(ctx.options, 'timeout');
    const result = await reviewCloseout(client, ctx.args[0] ?? '', { cwd: ctx.source_workspace_root ?? ctx.repo_root ?? process.cwd(), pmRoot: ctx.pm_root, base: readStringOption(ctx.options, 'base'), timeoutSeconds: timeout === undefined ? undefined : Number(timeout), revertCheck: readBooleanOption(ctx.options, 'revertCheck') === true });
    const { tests, ...receipt } = result;
    const test_summary = { total: tests.length, passed: 0, failed: 0, skipped: 0 };
    for (const test of tests) test_summary[test.result]++;
    return { ...receipt, test_summary, ...(result.ok ? {} : { exit_code: 1 }) };
  }
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
  if (ctx.command === 'review verdict') {
    const target = readStringOption(ctx.options, 'repo') !== undefined || readStringOption(ctx.options, 'pr') !== undefined ? targetOf(ctx.options) : {};
    const apply = readBooleanOption(ctx.options, 'apply') === true;
    return decide(client, apply ? provided ?? createGitHubTransport : undefined, { ...target, id: ctx.args[0] ?? '', verdict: parseVerdict(ctx.args[1] ?? ''), reason: readStringOption(ctx.options, 'reason') ?? '', commit: readStringOption(ctx.options, 'commit') ?? '', apply });
  }
  const target = targetOf(ctx.options);
  const transport = provided ?? createGitHubTransport();
  if (ctx.command === 'review respond' || ctx.command === 'review status') {
    const options = { bots: readStringOption(ctx.options, 'bots'), noticePattern: readStringOption(ctx.options, 'noticePattern'), apply: readBooleanOption(ctx.options, 'apply'), resolve: readBooleanOption(ctx.options, 'resolve') };
    return ctx.command === 'review respond' ? respond(client, transport, target.repo, target.pr, options) : reviewStatus(client, transport, target.repo, target.pr, options);
  }
  if (ctx.command === 'review reconcile') return reconcile(client, transport, target.repo, target.pr, readBooleanOption(ctx.options, 'dryRun') === true);
  const snapshot = await transport.snapshot(target.repo, target.pr);
  if (ctx.command === 'review import') return importFindings(client, snapshot, findingsOf(snapshot), { snapshotComplete: true });
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
    { name: 'conflicts', description: 'Expose opposed explicit judgments at one confirmed finding lineage and exact artifact scope; never resolve by votes', arguments: [{ name: 'item', required: true, description: 'ReviewFinding in the confirmed lineage' }], flags: [{ long: '--revision', type: 'string' as const, description: 'Exact native review_head artifact revision to compare' }], example: 'pm review conflicts finding-id --revision ARTIFACT_REVISION --json' },
    { name: 'requests', description: 'Request one missing source or test artifact per selected review obligation, with exact budget omissions', arguments: [], flags: [{ long: '--file', type: 'string' as const, description: 'Strict review-requests/v1 JSON selections, revision-bound arrivals and output budget' }], example: 'pm review requests --file requests.json --json' },
    ...['scope', 'carry-forward'].map(/** The host renders compact TOON by default and JSON on request. */ name => ({ name, description: name === 'scope' ? 'Capture explicitly reviewed native fields at verified historical revisions' : 'Compare review obligations across artifact revisions; attention never grants approval', arguments: [{ name: 'item', required: true, description: 'Target artifact tracker item' }], flags: [{ long: '--file', type: 'string' as const, description: 'Explicit scope selection JSON (scope) or captured receipt JSON (carry-forward)' }], example: `pm review ${name} sample-task --file ${name === 'scope' ? 'selection' : 'baseline'}.json --json` })),
    { name: 'ingest', description: 'Import a digest-pinned provider-neutral review artifact; completion remains unverified', arguments: [], flags: ['file', 'url', 'sha256'].map(/** Explicit selectors keep ingestion separate from live GitHub snapshots. */ name => ({ long: `--${name}`, type: 'string' as const, description: name === 'sha256' ? 'Independently verified SHA-256 of the artifact bytes' : `Explicit artifact ${name}; select exactly one file or URL` })), example: 'pm review ingest --file review.json --sha256 DIGEST --json' },
    { name: 'lineage', description: 'Read one canonical disposition; propose or explicitly confirm matching observations', arguments: [{ name: 'item', required: true, description: 'Imported ReviewFinding item id' }], flags: [{ long: '--with', type: 'string' as const, description: 'Candidate observation id from core duplicates or pm-jev' }, { long: '--confirm', type: 'boolean' as const, description: 'Confirm the proposed identity using --revision and --reason' }, { long: '--revision', type: 'string' as const, description: 'Current pair proposal hash' }, { long: '--reason', type: 'string' as const, description: 'Why these observations describe one logical finding' }], example: 'pm review lineage finding-id --with other-finding-id --json' },
    { name: 'coverage', description: 'Read explicit criterion review attention and stale judgments; no completion claim', arguments: [{ name: 'item', required: true, description: 'Item declaring acceptance and risk criteria' }], flags: [], example: 'pm review coverage sample-task --json' },
    { name: 'cover', description: 'Record an attributed criterion judgment with an exact review excerpt', arguments: [{ name: 'item', required: true, description: 'Item declaring acceptance and risk criteria' }], flags: ['revision', 'criterion', 'evidence', 'excerpt', 'reason', 'judgment'].map(/** Each selector is explicit and validated by the SDK operation. */ name => ({ long: `--${name}`, type: 'string' as const, description: name === 'judgment' ? 'reviewed|gap (attention, never proof)' : `Explicit ${name} binding; see review coverage` })), example: 'pm review cover sample-task --criterion AC1 --revision HASH --evidence finding-id --excerpt "Exact substantive review text" --judgment reviewed --reason "Explains the validation boundary"' },
    { name: 'closeout', description: 'Verify acceptance criteria with fresh linked tests and detect gamed gates; never closes the item', arguments: [{ name: 'item', required: true, description: 'Item whose completion evidence needs independent verification' }], flags: [{ long: '--base', type: 'string' as const, description: 'Git commit to compare with the current workspace' }, { long: '--timeout', type: 'string' as const, description: 'Total test budget per run, 1 to 600 seconds (default 60)' }, { long: '--revert-check', type: 'boolean' as const, description: 'Restore changed source in another disposable copy and require a named assertion to fail' }], example: 'pm review closeout sample-task --base main --revert-check --json' },
    { name: 'respond', description: 'Plan recorded inline replies and missing bot votes; dry-run unless --apply', arguments: [], flags: [...RESPONSE_FLAGS, { long: '--apply', type: 'boolean' as const, description: 'Write planned replies and votes to GitHub' }, { long: '--resolve', type: 'boolean' as const, description: 'Also resolve threads with recorded final decisions; default off' }], example: 'pm review respond --repo unbraind/pm-review --pr 1' },
    { name: 'status', description: 'Gate on unanswered findings, missing replies, bot votes, threads and exact-head review', arguments: [], flags: RESPONSE_FLAGS, example: 'pm review status --repo unbraind/pm-review --pr 1' },
    { name: 'reconcile', description: 'Close findings from live resolved threads, terminal alerts and merged PRs (GitHub read-only)', arguments: [], flags: [...TARGET_FLAGS, { long: '--dry-run', type: 'boolean' as const, description: 'Report planned closures without tracker writes' }], example: 'pm review reconcile --repo unbraind/pm-review --pr 1 --dry-run' },
    { name: 'find', description: 'Find imported tracker items by GitHub thread id or review-comment URL', arguments: [], flags: [{ long: '--thread', type: 'string' as const, description: 'PRRT_ thread id or GitHub review-comment URL' }], example: 'pm review find --thread PRRT_example' },
    { name: 'import', description: 'Import every bot thread, review body and issue comment as durable pm context', arguments: [], flags: TARGET_FLAGS, example: 'pm review import --repo unbraind/pm-rl --pr 68' },
    { name: 'verdict', description: 'Record a local verdict by envelope item id, or use GitHub coordinates for GitHub findings; apply only to GitHub', arguments: [{ name: 'item', required: true, description: 'Imported ReviewFinding item id' }, { name: 'verdict', required: true, description: 'pending|fix|refuse|duplicate|stale|informational' }], flags: [...TARGET_FLAGS, { long: '--reason', type: 'string' as const, description: 'Durable decision reasoning' }, { long: '--commit', type: 'string' as const, description: 'Commit SHA implementing or explaining this decision' }, { long: '--apply', type: 'boolean' as const, description: 'Vote on source content; also reply and resolve threads; requires write access' }], example: 'pm review verdict sample-gh-abcd refuse --repo unbraind/pm-rl --pr 68 --reason "Existing validation covers this input"' },
    { name: 'round', description: 'Gate the current head on finished review, checks, threads, votes and durable decisions', arguments: [], flags: [...TARGET_FLAGS, { long: '--compact', type: 'boolean' as const, description: 'Emit one host-rendered script line (JSON retains the full receipt)' }], example: 'pm review round --repo unbraind/pm-rl --pr 68 --compact' },
    { name: 'precedents', description: 'Find earlier fix and refuse reasoning across the complete tracker', arguments: [{ name: 'query', required: true, description: 'Words from a finding or its decision' }], flags: TARGET_FLAGS, example: 'pm review precedents "input validation"' },
  ];
  for (const command of commands) {
    api.registerCommand(defineCommand({ name: `review ${command.name}`, description: command.description, intent: 'Project management = context management: retain bot findings and their decisions', arguments: command.arguments, flags: command.flags, examples: [command.example], /** Delegate rendering and exit contracts to the PM host. */ run: (ctx: CommandHandlerContext) => runReviewCommand(ctx) }));
  }
}
