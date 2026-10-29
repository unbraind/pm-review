import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { envelope } from './envelope-fixture.ts';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { EXIT_CODE, decodeToon } from '@unbrained/pm-cli/sdk';
import type { EvidenceRequestResult } from '../src/requests-types.ts';

/** Run a consumer command with isolated HOME and tracker coordinates, preserving stderr for failures. */
function command(cwd: string, name: string, args: string[], pmRoot: string, home = cwd): string {
  const env = consumerEnv(cwd, pmRoot, home);
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${name} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

/** Bind source provenance to the consumer while isolating package-manager and Git configuration. */
function consumerEnv(cwd: string, pmRoot: string, home = cwd): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PM_PATH: pmRoot, PM_SOURCE_WORKSPACE_ROOT: cwd, PM_AUTHOR: 'install-test', GIT_CEILING_DIRECTORIES: dirname(cwd), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts' || /token|secret|password|credential|^NPM_MEDIA_SERVER$/i.test(key)) delete env[key];
  return env;
}

 test('packed npm/npx and native Bun/bunx consumers activate commands and search a real tracker', async t => {
  const root = resolve(import.meta.dirname, '..');
  // Reproduce an outer linked-test host whose source root differs from both consumers.
  const previousSourceRoot = process.env.PM_SOURCE_WORKSPACE_ROOT;
  process.env.PM_SOURCE_WORKSPACE_ROOT = root;
  t.after(() => { if (previousSourceRoot === undefined) delete process.env.PM_SOURCE_WORKSPACE_ROOT; else process.env.PM_SOURCE_WORKSPACE_ROOT = previousSourceRoot; });
  const { scratch, tarball, sdkVersion, files } = await packedPackage(t, 'pm-review-install-');
  assert.ok(files.includes('dist/index.js'));
  for (const file of files) assert.ok(file.startsWith('dist/') || ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(file), `unexpected packed file: ${file}`);
  for (const runtime of ['npm', 'bun']) {
    const cwd = join(scratch, runtime);
    await writeConsumer(cwd);
    const pmRoot = join(cwd, '.agents/pm');
    const args = runtime === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdkVersion}`] : ['add', '--ignore-scripts', tarball, `@unbrained/pm-cli@${sdkVersion}`];
    command(cwd, runtime, args, pmRoot);
    const runner = runtime === 'npm' ? 'npx' : 'bunx';
    const prefix = runtime === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
    command(cwd, runner, [...prefix, 'init', 'consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
    command(cwd, runner, [...prefix, 'install', tarball, '--project', '--json'], pmRoot);
    for (const action of ['ingest', 'import', 'verdict', 'round', 'precedents', 'reconcile', 'respond', 'status', 'closeout', 'coverage', 'cover', 'lineage', 'scope', 'carry-forward', 'requests', 'conflicts']) assert.match(command(cwd, runner, [...prefix, 'review', action, '--help'], pmRoot), /review/);
    assert.match(command(cwd, runner, [...prefix, 'review', 'reconcile', '--help'], pmRoot), /--dry-run/);
    const verdictHelp = command(cwd, runner, [...prefix, 'review', 'verdict', '--help'], pmRoot);
    assert.doesNotMatch(verdictHelp, /<value>\s+<value>/);
    for (const flag of ['repo', 'pr', 'reason', 'commit', 'apply']) assert.equal((verdictHelp.split('Intent:')[0].match(new RegExp(`--${flag}\\b`, 'g')) ?? []).length, 1, verdictHelp);
    assert.match(command(cwd, runner, [...prefix, 'review', 'find', '--help'], pmRoot), /--thread/);
    const lookup = JSON.parse(command(cwd, runner, [...prefix, 'review', 'find', '--thread', 'PRRT_missing', '--json'], pmRoot)) as { count: number };
    assert.equal(lookup.count, 0);
    const precedents = JSON.parse(command(cwd, runner, [...prefix, 'review', 'precedents', 'validation', '--json'], pmRoot)) as { count: number };
    assert.equal(precedents.count, 0);
    const schema = JSON.parse(command(cwd, runner, [...prefix, 'schema', 'list', '--json'], pmRoot)) as { extension: { name: string }[] };
    assert.ok(schema.extension.some(type => type.name === 'ReviewFinding'));
    command(cwd, runner, [...prefix, 'create', 'ReviewFinding', 'Packed searchable review context', '--description', 'Synthetic validation context', '--json'], pmRoot);
    const search = JSON.parse(command(cwd, runner, [...prefix, 'search', 'validation', '--json'], pmRoot)) as { count: number };
    assert.equal(search.count, 1);
    const coverageTarget = JSON.parse(command(cwd, runner, [...prefix, 'create', 'Task', 'Packed criterion map', '--ac', 'Review validation boundaries', '--json'], pmRoot)) as { id: string };
    const coverage = JSON.parse(command(cwd, runner, [...prefix, 'review', 'coverage', coverageTarget.id, '--json'], pmRoot)) as { total: number; unreviewed: number };
    assert.equal(coverage.total, 1);
    assert.equal(coverage.unreviewed, 1);
    assert.match(command(cwd, runner, [...prefix, 'review', 'coverage', coverageTarget.id], pmRoot), /unreviewed/);
    await verifyCarryForward(cwd, runner, prefix, pmRoot, coverageTarget.id);
    await verifyEvidenceRequests(cwd, runner, prefix, pmRoot, coverageTarget.id);
    verifyConflicts(cwd, runner, prefix, pmRoot);
    const evidence = JSON.parse(command(cwd, runner, [...prefix, 'create', 'ReviewFinding', 'Packed substantive review', '--description', 'Validate the input before writing.', '--field', 'review_bot=synthetic-reviewer', '--field', 'review_node_id=packed-node', '--field', 'review_repo=example/package', '--field', 'review_pr=2', '--field', 'review_url=https://github.com/example/package/pull/2#discussion_r1', '--field', `review_head=${'a'.repeat(40)}`, '--field', 'review_kind=thread', '--json'], pmRoot)) as { id: string };
    const lineage = JSON.parse(command(cwd, runner, [...prefix, 'review', 'lineage', evidence.id, '--json'], pmRoot)) as { canonical: string; observations: unknown[] };
    assert.equal(lineage.canonical, evidence.id);
    assert.equal(lineage.observations.length, 1);
    assert.match(command(cwd, runner, [...prefix, 'review', 'lineage', evidence.id], pmRoot), /canonical:/);
    const revision = (JSON.parse(command(cwd, runner, [...prefix, 'review', 'coverage', coverageTarget.id, '--json'], pmRoot)) as { revision: string }).revision;
    const covered = JSON.parse(command(cwd, runner, [...prefix, 'review', 'cover', coverageTarget.id, '--revision', revision, '--criterion', 'AC1', '--evidence', evidence.id, '--excerpt', 'Validate the input before writing.', '--judgment', 'reviewed', '--reason', 'Reviews the invalid input boundary', '--json'], pmRoot)) as { reviewed: number; judgments: { author: string }[] };
    assert.equal(covered.reviewed, 1);
    assert.equal(covered.judgments[0].author, 'install-test');
    const refused = spawnSync(runner, [...prefix, 'review', 'cover', coverageTarget.id, '--json'], { cwd, env: consumerEnv(cwd, pmRoot), encoding: 'utf8' });
    assert.equal(refused.status, 1, refused.stderr);
    assert.equal((JSON.parse(refused.stdout) as { refusal: { code: string } }).refusal.code, 'judgment_invalid');
    const artifact = JSON.stringify(envelope());
    await writeFile(join(cwd, 'review.json'), artifact);
    const artifactDigest = createHash('sha256').update(artifact).digest('hex');
    const ingestArgs = [...prefix, 'review', 'ingest', '--file', 'review.json', '--sha256', artifactDigest];
    const importedEnvelope = JSON.parse(command(cwd, runner, [...ingestArgs, '--json'], pmRoot)) as { created: number; completion: string; items: { id: string }[] };
    assert.equal(importedEnvelope.created, 2);
    assert.equal(importedEnvelope.completion, 'unverified');
    const localVerdict = JSON.parse(command(cwd, runner, [...prefix, 'review', 'verdict', importedEnvelope.items[0].id, 'refuse', '--reason', 'The document already explains this boundary', '--json'], pmRoot)) as { verdict: string; applied: boolean };
    assert.equal(localVerdict.verdict, 'refuse');
    assert.equal(localVerdict.applied, false);
    assert.match(command(cwd, runner, ingestArgs, pmRoot), /reused: 2/);
    await verifyCloseout(cwd, runner, prefix, pmRoot);
    verifyHostExitContract(cwd, runner, prefix, pmRoot);
    assert.ok((await readdir(cwd)).includes('node_modules'));
  }
 });

test('packed carry-forward and conflict witnesses work through npm global and Bun global host executables', async t => {
  const { scratch, tarball, sdkVersion } = await packedPackage(t, 'pm-review-global-install-');
  for (const runtime of ['npm', 'bun']) {
    const cwd = join(scratch, runtime);
    await writeConsumer(cwd);
    const pmRoot = join(cwd, '.agents/pm');
    const prefix = join(cwd, 'global');
    const env = { ...consumerEnv(cwd, pmRoot), BUN_INSTALL_GLOBAL_DIR: join(prefix, 'install/global'), BUN_INSTALL_BIN: join(prefix, 'bin') };
    const args = runtime === 'npm' ? ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdkVersion}`] : ['add', '--global', '--ignore-scripts', tarball, `@unbrained/pm-cli@${sdkVersion}`];
    const installed = spawnSync(runtime, args, { cwd, env, encoding: 'utf8', timeout: 180_000 });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    const host = join(prefix, 'bin/pm');
    command(cwd, host, ['init', 'consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
    command(cwd, host, ['install', tarball, '--project', '--json'], pmRoot);
    verifyConflicts(cwd, host, [], pmRoot);
    const target = JSON.parse(command(cwd, host, ['create', 'Task', 'Global scope artifact', '--ac', 'Review the selected native field', '--parent', 'none', '--assignee', 'none', '--reviewer', 'none', '--sprint', 'none', '--release', 'none', '--clear-deps', '--json'], pmRoot)) as { id: string };
    await verifyCarryForward(cwd, host, [], pmRoot, target.id);
  }
});

/** Execute real packed conflict packets through each supported host installation shape. */
function verifyConflicts(cwd: string, runner: string, prefix: string[], pmRoot: string): void {
  const ids: string[] = [];
  for (const verdict of ['fix', 'refuse']) {
    const fields = { review_bot: `synthetic-${verdict}`, review_node_id: `packed-conflict-${verdict}`, review_repo: 'example/package', review_pr: '2', review_url: `https://github.com/example/package/pull/2#${verdict}`, review_head: 'packed-artifact', review_verdict: verdict, review_verdict_source: 'local', review_reason: `Explicit ${verdict} reasoning at one artifact scope` };
    const created = JSON.parse(command(cwd, runner, [...prefix, 'create', 'ReviewFinding', `Packed conflict ${verdict}`, '--parent', 'none', ...Object.entries(fields).flatMap(([key, value]) => ['--field', `${key}=${value}`]), '--json'], pmRoot)) as { id: string };
    ids.push(created.id);
  }
  command(cwd, runner, [...prefix, 'comments', ids[0], '--add', 'review-lineage/v1 ' + JSON.stringify({ with: ids[1], revision: 'a'.repeat(64), reason: 'Previously persisted explicit identity confirmation' }), '--json'], pmRoot);
  for (const size of [0, 100001]) {
    if (size) command(cwd, runner, [...prefix, 'review', 'verdict', ids[1], 'refuse', '--repo', 'example/package', '--pr', '2', '--reason', 'r'.repeat(size), '--json'], pmRoot);
    for (const json of [false, true]) {
      const output = command(cwd, runner, [...prefix, 'review', 'conflicts', ids[0], '--revision', 'packed-artifact', ...(json ? ['--json'] : [])], pmRoot);
      const result = (json ? JSON.parse(output) : decodeToon(output)) as { state: string; resolution: string; judgments: { item: string; reason: string; reason_omitted: number }[] };
      assert.equal(result.state, 'conflict');
      assert.equal(result.resolution, 'unverified');
      assert.deepEqual(result.judgments.map(row => row.item).sort(), [...ids].sort());
      assert.ok(Buffer.byteLength(output) < 6000);
      if (size) {
        const refusal = result.judgments.find(row => row.item === ids[1])!;
        assert.equal(refusal.reason, 'r'.repeat(240));
        assert.equal(refusal.reason_omitted, size - 240);
      }
    }
  }
}

/** Reproduce a retirement at the copy filter boundary through the installed CLI. */
test('packed closeout excludes live global runtime state during workspace preparation', async t => {
  const { scratch, tarball, sdkVersion } = await packedPackage(t, 'pm-review-closeout-install-');
  const cwd = join(scratch, 'consumer');
  await writeConsumer(cwd);
  const pmRoot = join(cwd, '.agents/pm');
  command(cwd, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdkVersion}`], pmRoot);
  command(cwd, 'npx', ['--no-install', 'pm', 'init', 'copy-consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
  command(cwd, 'npx', ['--no-install', 'pm', 'install', tarball, '--project', '--json'], pmRoot);
  await verifyCloseout(cwd, 'npx', ['--no-install', 'pm'], pmRoot);
});

/** Capture exact built package bytes once per isolated installer scenario and preserve the allowlist inventory. */
async function packedPackage(t: TestContext, name: string) {
  const root = resolve(import.meta.dirname, '..');
  const scratch = await mkdtemp(join(tmpdir(), name));
  t.after(() => rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const output = command(root, 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], join(root, '.agents/pm'), scratch);
  const entries = JSON.parse(output.slice(output.lastIndexOf('\n[') + 1)) as { filename: string; files: { path: string }[] }[];
  const sdk = JSON.parse(await importManifest(root)) as { devDependencies: Record<string, string> };
  return { scratch, tarball: join(scratch, entries[0].filename), files: entries[0].files.map(file => file.path), sdkVersion: sdk.devDependencies['@unbrained/pm-cli'] };
}

/** Exercise installed package results through real host rendering and process exits. */
function verifyHostExitContract(cwd: string, runner: string, prefix: string[], pmRoot: string): void {
  const fixture = resolve(import.meta.dirname, 'host-fixture.ts');
  // Bun ignores NODE_OPTIONS preloads; pass its documented preload flag explicitly.
  const host = runner === 'bunx' ? 'bun' : runner;
  const hostArgs = runner === 'bunx' ? ['--preload', fixture, join(cwd, 'node_modules/.bin/pm')] : prefix;
  for (const action of ['round', 'status']) {
    for (const scenario of ['complete', 'incomplete', 'refusal']) {
      for (const flags of action === 'round' ? [['--json'], ['--compact'], ['--compact', '--json']] : [['--json']]) {
        const env = { ...consumerEnv(cwd, pmRoot), GITHUB_TOKEN: 'synthetic-only-token', NODE_OPTIONS: `--import=${pathToFileURL(fixture).href}`, PM_REVIEW_HOST_SCENARIO: scenario };
        const result = spawnSync(host, [...hostArgs, 'review', action, '--repo', 'example/package', '--pr', '1', ...flags], { cwd, env, encoding: 'utf8', timeout: 30_000 });
        const evidence = `${action}/${scenario}/${flags.join(' ')}\n${result.stdout}\n${result.stderr}`;
        assert.equal(result.error, undefined, evidence);
        assert.equal(result.status, scenario === 'complete' ? 0 : scenario === 'refusal' ? EXIT_CODE.USAGE : 1, evidence);
        if (scenario === 'refusal') {
          if (flags.includes('--json')) {
            const error = JSON.parse(result.stderr) as { detail: string; type: string; code: string; exit_code: number };
            assert.match(error.detail, /GraphQL request failed with HTTP 403/, evidence);
            assert.equal(error.code, 'command_failed', evidence);
            assert.equal(error.type, 'urn:pm-cli:error:command_failed', evidence);
            assert.equal(error.exit_code, EXIT_CODE.USAGE, evidence);
          } else assert.match(result.stderr, /GraphQL request failed with HTTP 403/, evidence);
        } else if (flags.includes('--json')) {
          const receipt = JSON.parse(result.stdout) as { complete: boolean; exit_code?: number };
          assert.equal(receipt.complete, scenario === 'complete', evidence);
          assert.equal(Object.hasOwn(receipt, 'exit_code'), scenario === 'incomplete', evidence);
          if (scenario === 'incomplete') assert.equal(receipt.exit_code, 1, evidence);
        } else {
          assert.match(result.stdout, new RegExp(`complete=${scenario === 'complete'}`), evidence);
          assert.equal(result.stdout.trim().split('\n').length, 1, evidence);
        }
        if (scenario !== 'refusal') assert.equal(result.stderr, '', evidence);
      }
    }
  }
}

/** Read package metadata without evaluating shipped extension code. */
async function importManifest(root: string): Promise<string> {
  return readFile(join(root, 'package.json'), 'utf8');
}

/** Materialize a minimal independent consuming workspace for one package manager. */
async function writeConsumer(cwd: string): Promise<void> {
  await mkdir(cwd);
  await writeFile(join(cwd, 'package.json'), '{"name":"review-consumer","private":true,"type":"module"}\n');
}

/** Check closeout through packed TOON/JSON host normalization in both consumer runtimes. */
async function verifyCloseout(cwd: string, runner: string, prefix: string[], pmRoot: string): Promise<void> {
  await writeFile(join(cwd, 'proof.md'), 'Recorded evidence');
  await writeFile(join(cwd, 'closeout.test.ts'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('packed closeout behavior', () => assert.equal(2 + 2, 4));\n");
  const item = JSON.parse(command(cwd, runner, [...prefix, 'create', 'Task', 'Packed closeout evidence', '--acceptance-criteria', '[test:packed closeout behavior]', '--json'], pmRoot)) as { id: string };
  const note = `closeout-before:${Buffer.from('Recorded evidence').toString('base64')}`;
  command(cwd, runner, [...prefix, 'files', item.id, '--add', `path=proof.md,note=${note}`, '--json'], pmRoot);
  command(cwd, runner, [...prefix, 'test', item.id, '--add-json', JSON.stringify({ command: `${process.execPath} --test --test-reporter=tap closeout.test.ts`, path: 'closeout.test.ts' }), '--json'], pmRoot);
  await verifyRetiringRuntime(cwd, runner, prefix, pmRoot, item.id);
  const report = JSON.parse(command(cwd, runner, [...prefix, 'review', 'closeout', item.id, '--json'], pmRoot)) as { ok: boolean; criteria: { verdict: string }[] };
  assert.equal(report.ok, true);
  assert.equal(report.criteria[0].verdict, 'proven');
  assert.match(command(cwd, runner, [...prefix, 'review', 'closeout', item.id], pmRoot), /proven/);
  command(cwd, runner, [...prefix, 'update', item.id, '--acceptance-criteria', '[test:missing proof]', '--json'], pmRoot);
  const refused = spawnSync(runner, [...prefix, 'review', 'closeout', item.id, '--json'], { cwd, env: consumerEnv(cwd, pmRoot), encoding: 'utf8', timeout: 60_000 });
  assert.equal(refused.error, undefined);
  assert.equal(refused.status, 1, refused.stderr);
  assert.equal((JSON.parse(refused.stdout) as { criteria: { verdict: string }[] }).criteria[0].verdict, 'unproven');
}

/** Retire one owned global runtime file at a deterministic real filesystem boundary. */
async function verifyRetiringRuntime(cwd: string, runner: string, prefix: string[], pmRoot: string, id: string): Promise<void> {
  const runtime = join(cwd, '.pm-cli/runtime/telemetry');
  await mkdir(runtime, { recursive: true });
  const transient = join(runtime, 'closeout-fixture-retiring.tmp');
  await writeFile(transient, 'Owned transient state');
  const preload = join(cwd, 'copy-race-preload.mjs');
  await writeFile(preload, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const original = fs.cpSync;
/** Inject the competing retirement after enumeration and before the copy reads the entry. */
fs.cpSync = (source, target, options) => original(source, target, { ...options, filter(path, destination) {
  const include = options.filter(path, destination);
  if (path === ${JSON.stringify(transient)}) { fs.unlinkSync(path); console.error('retired global runtime entry: .pm-cli/runtime/telemetry/closeout-fixture-retiring.tmp'); }
  return include;
} });
syncBuiltinESMExports();
`);
  const env = consumerEnv(cwd, pmRoot);
  const executable = runner === 'bunx' ? 'bun' : runner;
  const args = runner === 'bunx' ? ['--preload', preload, join(cwd, 'node_modules/.bin/pm')] : prefix;
  if (runner !== 'bunx') env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(preload).href}`;
  const result = spawnSync(executable, [...args, 'review', 'closeout', id, '--json'], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.equal((JSON.parse(result.stdout) as { ok: boolean }).ok, true);
  assert.equal(await readFile(transient, 'utf8'), 'Owned transient state');
  await rm(preload);
  await rm(transient);
}

/** Verify installed capture/JSON transport/TOON comparison and typed process refusals on both runtimes. */
async function verifyCarryForward(cwd: string, runner: string, prefix: string[], pmRoot: string, id: string): Promise<void> {
  const file = join(cwd, 'scope.json');
  const evidence = JSON.parse(command(cwd, runner, [...prefix, 'create', 'Task', 'Packed scope evidence', '--parent', 'none', '--assignee', 'none', '--reviewer', 'none', '--sprint', 'none', '--release', 'none', '--clear-deps', '--json'], pmRoot)) as { id: string };
  await writeFile(file, JSON.stringify({ version: 1, author: 'install-test', reason: 'Explicit packed validation review', obligations: [{ criterion: 'AC1', fields: ['description'], evidence: [{ id: evidence.id, version: 1 }], judgment: 'reviewed' }] }));
  const capture = command(cwd, runner, [...prefix, 'review', 'scope', id, '--file', 'scope.json', '--json'], pmRoot);
  await writeFile(file, capture);
  command(cwd, runner, [...prefix, 'update', id, '--priority', '1', '--json'], pmRoot);
  const args = [...prefix, 'review', 'carry-forward', id, '--file', 'scope.json'];
  const report = JSON.parse(command(cwd, runner, [...args, '--json'], pmRoot)) as { counts: { unchanged: number }; approval: string; artifact_changed: boolean };
  assert.equal(report.counts.unchanged, 1);
  assert.equal(report.approval, 'unverified');
  assert.equal(report.artifact_changed, true);
  assert.match(command(cwd, runner, args, pmRoot), /unchanged: 1/);
  command(cwd, runner, [...prefix, 'update', evidence.id, '--description', 'Touched packed review evidence', '--json'], pmRoot);
  const stale = JSON.parse(command(cwd, runner, [...args, '--json'], pmRoot)) as { counts: { stale: number }; approval: string };
  assert.equal(stale.counts.stale, 1);
  assert.equal(stale.approval, 'unverified');
  const invalid = spawnSync(runner, [...prefix, 'review', 'carry-forward', id, '--file', 'absent.json', '--json'], { cwd, env: consumerEnv(cwd, pmRoot), encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal((JSON.parse(invalid.stdout) as { refusal: { code: string } }).refusal.code, 'scope_unavailable');
}

/** Check shipped SDK and actual npm/Bun CLI rendering, arrivals, revisions and refusal exits. */
async function verifyEvidenceRequests(cwd: string, runner: string, prefix: string[], pmRoot: string, id: string): Promise<void> {
  const packet = { schema: 'review-requests/v1', select: [{ item: id, obligation: 'AC1', missing: 'test' }], arrivals: [] as { request: string; item: string; version: number; field: string; index: number }[], budget: { requests: 4, characters: 8192 } };
  const file = join(cwd, 'requests.json');
  const invocation = [...prefix, 'review', 'requests', '--file', 'requests.json'];
  await writeFile(file, JSON.stringify(packet, null, 2).replaceAll('\n', '\r\n'));
  const pending = JSON.parse(command(cwd, runner, [...invocation, '--json'], pmRoot)) as { requests: { key: string }[]; pending: number };
  assert.equal(pending.pending, 1);
  assert.equal(pending.requests.length, 1);
  assert.match(command(cwd, runner, invocation, pmRoot), /pending: 1/);
  const artifact = JSON.parse(command(cwd, runner, [...prefix, 'create', 'Task', 'Focused packed test artifact', '--description', 'One focused test of the validation boundary.', '--test', 'command=node --test test/focused.test.ts', '--json'], pmRoot)) as { id: string };
  packet.arrivals.push({ request: pending.requests[0].key, item: artifact.id, version: 1, field: 'tests', index: 0 });
  await writeFile(file, JSON.stringify(packet));
  const satisfied = JSON.parse(command(cwd, runner, [...invocation, '--json'], pmRoot)) as { pending: number; satisfied: unknown[]; approval: string };
  assert.equal(satisfied.pending, 0);
  assert.equal(satisfied.satisfied.length, 1);
  assert.equal(satisfied.approval, 'unverified');
  const sdkProbe = "import { PmClient } from '@unbrained/pm-cli/sdk';\nimport { reviewEvidenceRequests, serializeEvidenceRequests } from 'pm-review';\nimport { readFileSync } from 'node:fs';\nconst client = new PmClient({ cwd: process.cwd(), pmRoot: process.env.PM_PATH, author: 'install-test' });\nprocess.stdout.write(serializeEvidenceRequests(await reviewEvidenceRequests(client, JSON.parse(readFileSync('requests.json', 'utf8')))));\n";
  await writeFile(join(cwd, 'requests-sdk.ts'), sdkProbe);
  const native = command(cwd, runner === 'bunx' ? 'bun' : 'node', ['requests-sdk.ts'], pmRoot);
  assert.deepEqual(JSON.parse(native), satisfied);
  assert.equal(native, JSON.stringify(satisfied));
  await verifyPackedBudgets(cwd, runner, prefix, pmRoot, { ...packet, arrivals: [] });
  await writeFile(file, JSON.stringify(packet));
  command(cwd, runner, [...prefix, 'update', id, '--description', 'A successor obligation revision', '--json'], pmRoot);
  const replay = JSON.parse(command(cwd, runner, [...invocation, '--json'], pmRoot)) as { pending: number; rejected: { reason: string }[] };
  assert.equal(replay.pending, 1);
  assert.equal(replay.rejected[0].reason, 'request_not_current');
  const refused = spawnSync(runner, [...prefix, 'review', 'requests', '--file', 'absent.json', '--json'], { cwd, env: consumerEnv(cwd, pmRoot), encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal((JSON.parse(refused.stdout) as { refusal: { code: string } }).refusal.code, 'file_unavailable');
}

/** Measure actual child-process bytes so host reformatting or trailing framing cannot escape the final budget. */
async function verifyPackedBudgets(cwd: string, runner: string, prefix: string[], pmRoot: string, packet: object): Promise<void> {
  const file = join(cwd, 'requests.json');
  for (const json of [false, true]) {
    /** Execute the real installed host for one budget and decode its actual emitted wire format. */
    async function invoke(characters: number) {
      await writeFile(file, JSON.stringify({ ...packet, budget: { requests: 1, characters } }));
      const child = spawnSync(runner, [...prefix, 'review', 'requests', '--file', 'requests.json', ...(json ? ['--json'] : [])], { cwd, env: consumerEnv(cwd, pmRoot), encoding: 'utf8' });
      assert.equal(child.error, undefined);
      const result = (json ? JSON.parse(child.stdout) : decodeToon(child.stdout)) as EvidenceRequestResult;
      assert.equal(child.status, result.ok ? 0 : 1, child.stderr);
      return { result, bytes: Buffer.byteLength(child.stdout) };
    }
    const below = (await invoke(0)).result;
    if (below.ok || !below.minimum) assert.fail('Expected typed minimum-budget refusal');
    const minimum = below.minimum.characters;
    const all = (await invoke(Number.MAX_SAFE_INTEGER)).result;
    if (!all.ok) assert.fail('Expected full packed result');
    for (const ceiling of new Set([0, 297, minimum - 1, minimum, minimum + 1, all.characters - 1, all.characters, all.characters + 1, Number.MAX_SAFE_INTEGER])) {
      const { result, bytes } = await invoke(ceiling);
      if (result.ok) { assert.equal(result.characters, bytes); assert.ok(bytes <= ceiling); }
      else { assert.equal(result.refusal.code, 'budget_too_small'); assert.equal(result.minimum?.characters, minimum); assert.ok(ceiling < minimum); }
    }
  }
}
