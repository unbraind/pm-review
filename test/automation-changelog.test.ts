import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('all changelog entry points retain published dependency updates', () => {
  const manifest: { scripts: Record<string, string> } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['changelog', 'changelog:full', 'changelog:check', 'release:notes']) {
    assert.ok(manifest.scripts[name]?.split(/\s+/).includes('--dependency-updates'), `${name} must include --dependency-updates`);
  }
});

test('the configured sync regeneration passes the package changelog check in a real temporary tracker', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const manifest: { name: string; version: string; scripts: Record<string, string> } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(root, '.github/workflows/pm-github-sync.yml'), 'utf8');
  const script = /post-import-script:\s*"([\w:-]+)"/.exec(workflow)?.[1] ?? 'changelog:full';
  const directory = mkdtempSync(join(tmpdir(), 'automation-changelog-'));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|PM_(?:PATH|GLOBAL_PATH)$|npm_config_(?:userconfig|allow_scripts)$|NODE_TEST_CONTEXT$)/i.test(key)));
  const environment: NodeJS.ProcessEnv = { ...inherited, HOME: join(directory, 'home'), PM_PATH: join(directory, '.agents/pm'), GIT_CEILING_DIRECTORIES: dirname(directory), GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', NPM_CONFIG_USERCONFIG: devNull };
  for (const key of Object.keys(environment)) if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|NPM_MEDIA_SERVER/i.test(key)) delete environment[key];
  /** Run the real package tools and surface only their failed output. */
  function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: directory, env: environment, encoding: 'utf8', shell: process.platform === 'win32' && command === 'npm.cmd' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  try {
    mkdirSync(join(directory, 'home'));
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'junction');
    symlinkSync(join(root, 'scripts'), join(directory, 'scripts'), 'junction');
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, private: true, type: 'module', scripts: manifest.scripts }));
    run(process.execPath, [join(root, 'node_modules/.bin/pm'), 'init', 'fixture', '--defaults', '--agent-guidance', 'skip', '--no-extensions']);
    run(process.execPath, [join(root, 'node_modules/.bin/pm'), 'create', 'Synthetic delivered change', '--id', 'fixture-work', '--type', 'Task', '--status', 'closed', '--close-reason', 'Synthetic release evidence', '--release', manifest.version, '--create-mode', 'progressive', '--no-extensions']);
    run('git', ['init', '--quiet']);
    run('git', ['add', 'package.json', '.agents/pm/settings.json']);
    run('git', ['-c', 'user.name=unbrained', '-c', 'user.email=1153461+unbraind@users.noreply.github.com', 'commit', '--quiet', '-m', 'Initialize synthetic changelog fixture']);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // The pinned reusable workflow adds this flag only for its default script.
    run(npm, ['run', script, ...(script === 'changelog:full' ? ['--', '--no-pending-release'] : [])]);
    run(npm, ['run', 'changelog:check']);
    assert.match(readFileSync(join(directory, 'CHANGELOG.md'), 'utf8'), /^# Changelog/m);

    await t.test('pending-only drift passes read-only, but strict and versioned checks fail', () => {
      run('git', ['tag', `v${manifest.version}`]);
      run(npm, ['run', 'changelog:full']);
      const output = join(directory, 'CHANGELOG.md');
      const generated = readFileSync(output, 'utf8');
      assert.doesNotMatch(generated, /^## Unreleased$/m);
      const pending = generated.replace(/^(# Changelog\n\n)/, '$1## Unreleased\n\n- A pending change.\n\n');
      const versioned = pending.replace(/^## (\d[^\n]+)$/m, '## $1 (edited)');
      assert.match(pending, /^## Unreleased$/m);
      assert.notEqual(versioned, pending);
      for (const { content, flags, status, diagnostic } of [
        { content: pending, flags: ['changelog:check'], status: 0, diagnostic: /pending_only/ },
        { content: pending, flags: ['changelog:full', '--', '--check-pending'], status: 1, diagnostic: /out of date/ },
        { content: versioned, flags: ['changelog:check'], status: 1, diagnostic: /out of date/ },
      ]) {
        writeFileSync(output, content);
        const result = spawnSync(npm, ['run', '--silent', ...flags],
          { cwd: directory, env: environment, encoding: 'utf8', shell: process.platform === 'win32' });
        assert.ifError(result.error);
        assert.equal(result.status, status, result.stderr);
        assert.match(result.stderr, diagnostic);
        assert.equal(result.stdout, '');
        assert.equal(readFileSync(output, 'utf8'), content);
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
