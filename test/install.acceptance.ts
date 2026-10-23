import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { envelope } from './envelope-fixture.ts';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { EXIT_CODE } from '@unbrained/pm-cli/sdk';

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
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PM_PATH: pmRoot, PM_SOURCE_WORKSPACE_ROOT: cwd, PM_AUTHOR: 'install-test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  return env;
}

 test('packed npm/npx and native Bun/bunx consumers activate commands and search a real tracker', async t => {
  const root = resolve(import.meta.dirname, '..');
  // Reproduce an outer linked-test host whose source root differs from both consumers.
  const previousSourceRoot = process.env.PM_SOURCE_WORKSPACE_ROOT;
  process.env.PM_SOURCE_WORKSPACE_ROOT = root;
  t.after(() => { if (previousSourceRoot === undefined) delete process.env.PM_SOURCE_WORKSPACE_ROOT; else process.env.PM_SOURCE_WORKSPACE_ROOT = previousSourceRoot; });
  const scratch = await mkdtemp(join(tmpdir(), 'pm-review-install-'));
  // Recursive removal can race Bun's install cache and throw ENOTEMPTY. Node retries that error only when asked.
  t.after(async () => { await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  // npm 10 still runs prepare during pack; its source workspace must use the source tracker.
  const packOutput = command(root, 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], join(root, '.agents/pm'), scratch);
  // npm 10 can prefix its final JSON array with prepare output.
  const manifest = JSON.parse(packOutput.slice(packOutput.lastIndexOf('\n[') + 1)) as { filename: string; files: { path: string }[] }[];
  const files = manifest[0].files.map(file => file.path);
  assert.ok(files.includes('dist/index.js'));
  for (const file of files) assert.ok(file.startsWith('dist/') || ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(file), `unexpected packed file: ${file}`);
  const tarball = join(scratch, manifest[0].filename);
  const sdk = JSON.parse(await importManifest(root)) as { devDependencies: Record<string, string> };
  for (const runtime of ['npm', 'bun']) {
    const cwd = join(scratch, runtime);
    await writeConsumer(cwd);
    const pmRoot = join(cwd, '.agents/pm');
    const args = runtime === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`] : ['add', '--ignore-scripts', tarball, `@unbrained/pm-cli@${sdk.devDependencies['@unbrained/pm-cli']}`];
    command(cwd, runtime, args, pmRoot);
    const runner = runtime === 'npm' ? 'npx' : 'bunx';
    const prefix = runtime === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm'];
    command(cwd, runner, [...prefix, 'init', 'consumer', '--defaults', '--agent-guidance', 'skip', '--json'], pmRoot);
    command(cwd, runner, [...prefix, 'install', tarball, '--project', '--json'], pmRoot);
    for (const action of ['ingest', 'import', 'verdict', 'round', 'precedents', 'reconcile', 'respond', 'status', 'closeout', 'coverage', 'cover', 'lineage']) assert.match(command(cwd, runner, [...prefix, 'review', action, '--help'], pmRoot), /review/);
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
