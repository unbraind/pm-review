import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { PmClient } from '@unbrained/pm-cli/sdk';
import type { CloseoutChange, CloseoutOptions } from './closeout-types.ts';
import { artifactPath } from './closeout-state.ts';

/** Minimal host result preserves assertion, context, trust and timeout semantics. */
export interface CloseoutRun { command?: string; path?: string; status: string; stdout?: string; stderr?: string; failure_category?: string; execution_receipt?: { code: string; stream: string } }
/** A disposable run has either parsed host evidence or a bounded refusal. */
export interface CloseoutExecution { runs: CloseoutRun[]; error: string; functions?: { file: string; start: number; end: number; count: number }[] }

/** Kill the entire disposable host process group so timed-out tests cannot keep running. */
function killGroup(pid: number): void {
  try {
    const children = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    for (const child of children.split(/\s+/).filter(Boolean)) killGroup(Number(child));
  } catch { /* A completed process has no children metadata; group cleanup still applies. */ }
  try { process.kill(-pid, 'SIGKILL'); }
  catch { try { process.kill(pid, 'SIGKILL'); } catch { /* The process may already have exited. */ } }
}

/** Run a pinned host with bounded wall time and output, independent of linked timeout overrides. */
export function boundedHost(args: string[], cwd: string, timeout: number): Promise<CloseoutExecution> {
  return new Promise(resolveResult => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    delete env.PM_SOURCE_WORKSPACE_ROOT;
    delete env.PM_PATH;
    delete env.PM_GLOBAL_PATH;
    const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let error = '';
    const timer = setTimeout(/** Wall time covers setup, every linked command and all descendants. */ () => { error = 'Closeout test budget exceeded'; killGroup(child.pid!); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', /** Keep output memory bounded even when a command floods stdout. */ (chunk: string) => { stdout += chunk; if (stdout.length > 2_000_000) { error = 'Closeout host output limit exceeded'; killGroup(child.pid!); } });
    child.stderr.on('data', /** Consume stderr without retaining private raw logs. */ () => {});
    child.on('error', /** Spawn failures also produce an explicit absent-evidence receipt. */ () => { error = 'Pinned test host could not start'; });
    child.on('close', /** Host failures without parseable evidence never count as execution. */ () => {
      clearTimeout(timer);
      killGroup(child.pid!);
      if (!error) {
        try {
          const parsed = JSON.parse(stdout) as { run_results?: CloseoutRun[] };
          if (Array.isArray(parsed.run_results)) { resolveResult({ runs: parsed.run_results, error: '' }); return; }
        } catch { /* Report malformed or interrupted host output as absent evidence. */ }
        error = 'Pinned test host returned no execution evidence';
      }
      resolveResult({ runs: [], error });
    });
  });
}

/** A refused artifact carries only its workspace-relative identity. */
class CopyPolicyError extends Error {
  /** Stable category is safe to include in compact failure receipts. */
  readonly code = 'ARTIFACT_SYMLINK';
  /** Relative artifact name helps callers distinguish source from generated caches. */
  readonly file: string;
  /** Capture relative evidence without disclosing the source workspace root. */
  constructor(root: string, path: string) {
    super('Artifact links cannot enter a disposable workspace');
    this.file = relative(root, path);
  }
}

/** Refuse copied symlinks so commands cannot write through to original artifact paths. */
function regularCopyEntry(path: string, root: string): boolean {
  if (lstatSync(path).isSymbolicLink()) throw new CopyPolicyError(root, path);
  return true;
}

/** Preserve only managed tracker dependency links while applying artifact policy everywhere else. */
function trackerCopyEntry(path: string, root: string, trackerRoot: string): boolean {
  const parts = relative(trackerRoot, path).split(sep);
  return parts[0] === 'extensions' && parts.includes('node_modules') || regularCopyEntry(path, root);
}

/** Report preparation categories without echoing private paths or raw command output. */
export function preparationFailure(failure: unknown): string {
  if (failure instanceof Error && 'code' in failure && typeof failure.code === 'string' && /^[A-Z0-9_]+$/.test(failure.code)) return failure.code;
  return failure instanceof SyntaxError ? 'SyntaxError' : failure instanceof TypeError ? 'TypeError' : 'Error';
}

/** Copy source and tracker into a disposable workspace; never revert or record tests in the original. */
export async function executeCloseout(client: PmClient, id: string, options: CloseoutOptions, restore: CloseoutChange[] = []): Promise<CloseoutExecution> {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'pm-review-closeout-')));
  const workspace = join(sandbox, 'workspace');
  let result: CloseoutExecution;
  let phase = 'workspace-root';
  try {
    const sourceRoot = realpathSync(options.cwd);
    if (existsSync(join(sourceRoot, '.git'))) execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', '--quiet', '--', sourceRoot, workspace], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const trackerSource = realpathSync(options.pmRoot);
    phase = 'workspace-copy';
    cpSync(sourceRoot, workspace, { recursive: true, filter: /** Exclude caches and refuse links that could write through to original artifacts. */ path => {
      if (path !== sourceRoot && basename(path) === '.git') return false;
      if (['node_modules', 'coverage', '.bun', '.npm', '.cache'].includes(relative(sourceRoot, path))) return false;
      return trackerCopyEntry(path, sourceRoot, trackerSource);
    } });
    const tracker = join(workspace, '.closeout-pm');
    phase = 'tracker-copy';
    cpSync(trackerSource, tracker, { recursive: true, filter: /** PM-managed dependency links share the same explicit exception as workspace node_modules. */ path => {
      return trackerCopyEntry(path, trackerSource, trackerSource);
    } });
    const modules = join(sourceRoot, 'node_modules');
    if (existsSync(modules)) symlinkSync(modules, join(workspace, 'node_modules'), 'dir');
    phase = 'source-restore';
    for (const change of restore) {
      const target = artifactPath(workspace, change.file);
      if (change.before === null) rmSync(target, { force: true });
      else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, change.before); }
    }
    // Resolve through the package's installed peer, never a possibly newer global host.
    const cli = resolve(dirname(createRequire(import.meta.url).resolve('@unbrained/pm-cli/cli')), '../cli.js');
    const seconds = options.timeoutSeconds ?? 60;
    // Reading through the supplied client ensures hosted/back-end failures are visible before execution.
    await client.get(id, { depth: 'full' });
    const counters = join(sandbox, 'counters');
    mkdirSync(counters);
    phase = 'test-host';
    const execution = await boundedHost([cli, '--no-extensions', '--json', '--pm-path', tracker, 'test', id, '--run', '--timeout', String(seconds), '--fail-on-skipped', '--fail-on-empty-test-run', '--env-set', `NODE_V8_COVERAGE=${counters}`], workspace, seconds * 1000);
    phase = 'native-counters';
    execution.functions = [];
    for (const entry of readdirSync(counters)) {
      const report = JSON.parse(readFileSync(join(counters, entry), 'utf8')) as { result: { url: string; functions: { ranges: { startOffset: number; endOffset: number; count: number }[] }[] }[] };
      for (const script of report.result) {
        if (!script.url.startsWith('file:')) continue;
        const file = relative(workspace, fileURLToPath(script.url));
        if (file.split(sep)[0] === '..') continue;
        for (const fn of script.functions.slice(1)) {
          const range = fn.ranges[0];
          execution.functions.push({ file, start: range.startOffset, end: range.endOffset, count: range.count });
        }
      }
    }
    result = execution;
  } catch (failure) {
    result = { runs: [], error: `Disposable workspace or native coverage could not be prepared (${phase}/${preparationFailure(failure)}${failure instanceof CopyPolicyError ? `:${failure.file}` : ''})` };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return result;
}
