import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/** Run a consumer command with isolated HOME and tracker coordinates, preserving stderr for failures. */
function command(cwd: string, name: string, args: string[], pmRoot: string, home = cwd): string {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PM_PATH: pmRoot, PM_AUTHOR: 'install-test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: '/dev/null', npm_config_userconfig: '/dev/null' };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  const result = spawnSync(name, args, { cwd, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${name} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

 test('packed npm/npx and native Bun/bunx consumers activate commands and search a real tracker', async t => {
  const root = resolve(import.meta.dirname, '..');
  const scratch = await mkdtemp(join(tmpdir(), 'pm-review-install-'));
  t.after(async () => { await rm(scratch, { recursive: true, force: true }); });
  const manifest = JSON.parse(command(root, 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], join(scratch, '.agents/pm'), scratch)) as { filename: string; files: { path: string }[] }[];
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
    for (const action of ['import', 'verdict', 'round', 'precedents']) assert.match(command(cwd, runner, [...prefix, 'review', action, '--help'], pmRoot), /review/);
    const precedents = JSON.parse(command(cwd, runner, [...prefix, 'review', 'precedents', 'validation', '--json'], pmRoot)) as { count: number };
    assert.equal(precedents.count, 0);
    const schema = JSON.parse(command(cwd, runner, [...prefix, 'schema', 'list', '--json'], pmRoot)) as { extension: { name: string }[] };
    assert.ok(schema.extension.some(type => type.name === 'ReviewFinding'));
    command(cwd, runner, [...prefix, 'create', 'ReviewFinding', 'Packed searchable review context', '--description', 'Synthetic validation context', '--json'], pmRoot);
    const search = JSON.parse(command(cwd, runner, [...prefix, 'search', 'validation', '--json'], pmRoot)) as { count: number };
    assert.equal(search.count, 1);
    assert.ok((await readdir(cwd)).includes('node_modules'));
  }
 });

/** Read package metadata without evaluating shipped extension code. */
async function importManifest(root: string): Promise<string> {
  return readFile(join(root, 'package.json'), 'utf8');
}

/** Materialize a minimal independent consuming workspace for one package manager. */
async function writeConsumer(cwd: string): Promise<void> {
  await mkdir(cwd);
  await writeFile(join(cwd, 'package.json'), '{"name":"review-consumer","private":true,"type":"module"}\n');
}
