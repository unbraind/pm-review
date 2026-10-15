/** Exercise release thread resolution through synthetic GitHub CLI responses. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { resolveReleaseThreads } from '../scripts/resolve-release-threads.ts';

const scratch = mkdtempSync(join(tmpdir(), 'pm-review-release-threads-'));
const root = resolve(import.meta.dirname, '..');
after(() => rmSync(scratch, { recursive: true, force: true }));

test('release thread resolution preserves the query policy and serial mutation arguments', () => {
  const summary = join(scratch, 'summary');
  writeFileSync(summary, 'Existing summary\n');
  const calls: string[][] = [];
  const received: string[][] = [];
  resolveReleaseThreads('example', 'package', '42', summary, args => {
    received.push([...args]);
    if (received.length === 1) {
      assert.deepEqual(args.slice(0, 2), ['api', 'graphql']);
      assert.match(args[3], /^query=query\(\$o:String!,\$r:String!,\$n:Int!\)/);
      assert.match(args[3], /reviewThreads\(first:100\).*comments\(first:100\)/);
      assert.deepEqual(args.slice(4, 11), ['-F', 'o=example', '-F', 'r=package', '-F', 'n=42', '--jq']);
      // Execute the actual unchanged jq filter against varied author and completeness cases.
      const nodes = [
        thread('eligible', false, [{ login: 'coderabbitai', __typename: 'Bot' }]),
        thread('resolved', true, [{ login: 'coderabbitai', __typename: 'Bot' }]),
        thread('human', false, [{ login: 'coderabbitai', __typename: 'User' }]),
        thread('other', false, [{ login: 'other', __typename: 'Bot' }]),
        thread('empty', false, []),
        thread('deleted', false, [null]),
        thread('mixed', false, [{ login: 'coderabbitai', __typename: 'Bot' }, { login: 'reviewer', __typename: 'User' }]),
        { ...thread('truncated', false, [{ login: 'coderabbitai', __typename: 'Bot' }]), comments: { totalCount: 101, nodes: [{ author: { login: 'coderabbitai', __typename: 'Bot' } }] } },
      ];
      const filtered = spawnSync('jq', ['-r', args[11]], {
        input: JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } }), encoding: 'utf8',
      });
      assert.equal(filtered.status, 0, filtered.stderr);
      assert.equal(filtered.stdout, 'eligible\n');
      return { success: true, stdout: 'eligible\n\nfailed\nlast\\literal\n' };
    }
    return { success: received.length !== 3, stdout: '' };
  });
  for (const id of ['eligible', 'failed', 'last\\literal']) {
    calls.push(['api', 'graphql', '-f', 'query=mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}', '-F', `t=${id}`]);
  }
  assert.deepEqual(received.slice(1), calls);
  assert.equal(readFileSync(summary, 'utf8'), 'Existing summary\nAuto-resolved bot review thread eligible on release PR #42.\nAuto-resolved bot review thread last\\literal on release PR #42.\n');
});

/** Construct one GraphQL thread with a complete comment connection. */
function thread(id: string, isResolved: boolean, authors: (null | { login: string; __typename: string })[]) {
  return { id, isResolved, comments: { totalCount: authors.length, nodes: authors.map(author => ({ author })) } };
}

test('failed or empty thread queries perform no mutation or summary write', () => {
  for (const success of [false, true]) {
    let calls = 0;
    resolveReleaseThreads('example', 'package', '42', scratch, () => { calls++; return { success, stdout: '' }; });
    assert.equal(calls, 1);
  }
});

test('summary write failures preserve later resolution attempts', () => {
  let calls = 0;
  resolveReleaseThreads('example', 'package', '42', scratch, () => {
    calls++;
    return { success: calls !== 1, stdout: calls === 1 ? 'first\nsecond\n' : '' };
  });
  assert.equal(calls, 3);
});

test('release helper entry point uses gh without a shell and ignores transport failures', () => {
  const executable = join(scratch, 'gh');
  const summary = join(scratch, 'cli-summary');
  writeFileSync(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--jq')) process.stdout.write('cli-thread\\n');
else if (!args.includes('t=cli-thread')) process.exitCode = 1;
`, { mode: 0o755 });
  const run = (path: string) => spawnSync(process.execPath, ['scripts/resolve-release-threads.ts', 'example', 'package', '42', summary], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: path },
  });
  const success = run(`${scratch}:${process.env.PATH}`);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(readFileSync(summary, 'utf8'), 'Auto-resolved bot review thread cli-thread on release PR #42.\n');
  writeFileSync(executable, '#!/bin/sh\nexit 1\n');
  assert.equal(run(scratch).status, 0);
  rmSync(executable);
  assert.equal(run(scratch).status, 0);
  assert.equal(readFileSync(summary, 'utf8').split('\n').length, 2);
});

test('release workflow invokes thread helper as a literal Node command', () => {
  const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /node scripts\/resolve-release-threads\.ts "\$owner" "\$repo" "\$pr_number" "\$GITHUB_STEP_SUMMARY"/);
  assert.doesNotMatch(workflow, /resolveReviewThread\(/);
});
