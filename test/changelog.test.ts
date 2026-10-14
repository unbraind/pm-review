import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createChangelog } from 'pm-changelog';
import { canonicalFindingLinks, runChangelog } from '../scripts/changelog.ts';
import { findingsOf } from '../src/findings.ts';
import { importFindings } from '../src/tracker.ts';
import { pullRequest, tracker } from './helpers.ts';

test('changelog maps the pinned generator custom-type link to the persisted file', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const pr = pullRequest({ reviews: [], comments: [] });
  const id = (await importFindings(client, pr, findingsOf(pr))).items[0].id;
  const base = 'https://github.com/unbraind/pm-review/blob/main/.agents/pm';
  const generated = createChangelog({ items: [{ id, title: 'Synthetic finding', type: 'ReviewFinding', status: 'closed' }], itemUrlBase: base }).markdown;
  assert.ok(generated.includes(`${base}/reviewfindings/${id}.toon`), 'minimal upstream reproduction');
  const canonical = canonicalFindingLinks(generated, base);
  assert.ok(canonical.includes(`${base}/review-findings/${id}.toon`));
  assert.equal(canonicalFindingLinks('ordinary text', base), 'ordinary text');
  assert.ok(readFileSync(join(pmRoot, 'review-findings', `${id}.toon`), 'utf8'));
  const input = join(cwd, 'items.json');
  writeFileSync(input, JSON.stringify({ items: (await client.listAllComplete()).items }));
  const args = ['--input', input, '--item-url-base', base, '--status', 'open', '--mode', 'replace'];
  assert.equal(runChangelog([...args, '--check'], cwd), 1);
  assert.equal(runChangelog(args, cwd), 0);
  assert.equal(runChangelog([...args, '--check'], cwd), 0);
  writeFileSync(join(cwd, 'CHANGELOG.md'), 'stale');
  assert.equal(runChangelog([...args, '--check'], cwd), 1);
  assert.equal(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8'), 'stale');
  assert.equal(runChangelog([...args, '--output', 'CUSTOM.md'], cwd), 0);
  assert.ok(readFileSync(join(cwd, 'CUSTOM.md'), 'utf8').includes(`/review-findings/${id}.toon`));
  assert.equal(runChangelog(['--unknown-option'], cwd), 1);
  writeFileSync(input, JSON.stringify([{ id: 'missing-item', title: 'Missing finding', type: 'ReviewFinding', status: 'open' }]));
  assert.throws(() => runChangelog(args, cwd), /no branch file/);
});

test('changelog corrects and validates the configured alternate item URL base', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const snapshot = pullRequest({ reviews: [], comments: [] });
  const imported = await importFindings(client, snapshot, findingsOf(snapshot));
  const id = imported.items[0].id;
  const base = 'https://example.test/project/tracker';
  assert.equal(canonicalFindingLinks(`[item](${base}/reviewfindings/${id}.toon)`, `${base}/`), `[item](${base}/review-findings/${id}.toon)`);
  await client.update(id, { title: 'Finding with [external evidence](https://other.test/evidence.toon)' });
  const input = join(cwd, 'items.json');
  writeFileSync(input, JSON.stringify((await client.listAllComplete()).items));
  const args = ['--input', input, '--status', 'open', `--item-url-base=${base}/`, '--pm-root', pmRoot];
  assert.equal(runChangelog(args, cwd), 0);
  assert.ok(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8').includes(`${base}/review-findings/${id}.toon`));
  assert.ok(readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8').includes('https://other.test/evidence.toon'));
  assert.equal(runChangelog([...args, '--check'], cwd), 0);
});

test('changelog rejects missing branch files under an alternate configured base', async t => {
  const { cwd } = await tracker(t);
  const input = join(cwd, 'items.json');
  writeFileSync(input, JSON.stringify([{ id: 'missing-item', title: 'Missing finding', type: 'ReviewFinding', status: 'open' }]));
  assert.throws(() => runChangelog(['--input', input, '--status', 'open', '--item-url-base', 'https://example.test/tracker'], cwd), /no branch file/);
});

test('changelog writes and checks output larger than 1 MiB without truncation', async t => {
  const { cwd } = await tracker(t);
  const input = join(cwd, 'items.json');
  const items = Array.from({ length: 12000 }, (_, index) => ({ id: `history-${index}`, title: `Historical change ${index}: ${'evidence '.repeat(16)}`, type: 'Issue', status: 'closed' }));
  items[0].title += ' [external evidence](https://other.test/history.toon)';
  writeFileSync(input, JSON.stringify(items));
  const args = ['--input', input, '--status', 'closed', '--mode', 'replace'];
  assert.equal(runChangelog(args, cwd), 0);
  const markdown = readFileSync(join(cwd, 'CHANGELOG.md'), 'utf8');
  assert.ok(Buffer.byteLength(markdown) > 1024 * 1024);
  assert.ok(markdown.includes('history-11999'));
  assert.equal(runChangelog([...args, '--check'], cwd), 0);
});

test('changelog CLI publishes canonical stdout and GitHub step summaries', async t => {
  const { client, cwd } = await tracker(t);
  const id = (await importFindings(client, pullRequest({ reviews: [], comments: [] }), findingsOf(pullRequest({ reviews: [], comments: [] })))).items[0].id;
  const input = join(cwd, 'items.json');
  writeFileSync(input, JSON.stringify((await client.listAllComplete()).items));
  const summary = join(cwd, 'summary.md');
  const args = [resolve('scripts/changelog.ts'), '--input', input, '--status', 'open', '--item-url-base', 'https://github.com/unbraind/pm-review/blob/main/.agents/pm', '--stdout', '--github-step-summary'];
  for (const withSummary of [false, true]) {
    const env = { ...process.env };
    delete env.GITHUB_STEP_SUMMARY;
    if (withSummary) env.GITHUB_STEP_SUMMARY = summary;
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`/review-findings/${id}.toon`));
    if (withSummary) assert.equal(readFileSync(summary, 'utf8'), result.stdout);
  }
  assert.equal(runChangelog(['--input', input, '--status', 'open', '--stdout'], cwd), 0);
});
