import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import { canonicalReviewItems, findingLineage, lineageGroups, lineageItems } from '../src/lineage.ts';
import type { LineageCode, LineageResult, LineageView, LineageIssue } from '../src/lineage.ts';
import { fieldOptions, importFindings, precedents, recordVerdict, reviewItems } from '../src/tracker.ts';
import { findingsOf } from '../src/findings.ts';
import { decide } from '../src/verdict.ts';
import { responsePlan } from '../src/respond.ts';
import { evaluateRound } from '../src/round.ts';
import { inFixtureWorkspace, tracker, lineageFixture as fixture } from './helpers.ts';
/** Require the typed refusal and a useful remedy, including on registered CLI results. */
function refused(result: LineageResult, code: LineageCode): void {
  if (!result.ok) {
    assert.ok(result.refusal.remedy.length > 20, 'refusal supplies a next action');
    assert.equal(result.refusal.code, code);
  } else assert.fail(`Expected refusal ${code}, received a lineage view`);
}

/** Read the current pair hash, then explicitly confirm that exact proposal. */
async function confirm(client: Awaited<ReturnType<typeof tracker>>['client'], a: string, b: string): Promise<LineageView> {
  const proposal = await findingLineage(client, a, { with: b }) as LineageView;
  return await findingLineage(client, a, { with: b, confirm: true, revision: proposal.revision, reason: 'Both observations identify the same input validation defect' }) as LineageView;
}

test('near matches stay read-only proposals until explicit confirmation; one canonical disposition serves both providers', async t => {
  const { client, ids, pr } = await fixture(t);
  const before = JSON.stringify((await client.listAllComplete()).items);
  const proposal = await findingLineage(client, ids[1], { with: ids[0] }) as LineageView;
  assert.equal(proposal.observations.length, 1);
  assert.equal(proposal.proposal!.confirmed, false);
  assert.equal(proposal.proposal!.canonical, ids[0]);
  assert.ok(proposal.proposal!.score > 0);
  assert.equal(JSON.stringify((await client.listAllComplete()).items), before);
  const linked = await confirm(client, ids[1], ids[0]);
  assert.equal(linked.canonical, ids[0]);
  assert.equal(linked.observations.length, 2);
  assert.equal(new Set(linked.observations.map(row => row.provider)).size, 2);
  assert.equal(new Set(linked.observations.map(row => row.revision)).size, 2);
  const comments = (await client.comments(ids[1])).comments.length;
  await confirm(client, ids[1], ids[0]);
  assert.equal((await client.comments(ids[1])).comments.length, comments);
  await decide(client, undefined, { id: ids[1], repo: pr.repo, pr: pr.number, verdict: 'fix', reason: 'Input boundary fixed once for both reviewers', commit: 'c'.repeat(40), apply: false });
  const items = await reviewItems(client);
  assert.ok(items.every(row => row.review_verdict === 'fix' && row.review_commit === 'c'.repeat(40)));
  assert.equal(evaluateRound(pr, items).pending_items.length, 0);
  assert.equal(responsePlan(pr, items, 'author', {}).actions.filter(row => row.kind === 'reply').length, 2);
  assert.equal((await precedents(client, 'Input boundary')).length, 1);
  const raw = await lineageItems(client);
  assert.equal(raw.filter(row => row.review_verdict_source === 'local').length, 1);
  assert.equal((await findingLineage(client, ids[1]) as LineageView).disposition.verdict, 'fix');
});

test('duplicate imports preserve one disposition and source withdrawal retains reasoning and revisions', async t => {
  const { client, ids, pr } = await fixture(t);
  await confirm(client, ids[0], ids[1]);
  const original = (await lineageItems(client)).find(row => row.id === ids[1])!;
  await recordVerdict(client, original, 'refuse', 'The existing validation already covers this boundary', '');
  const again = await importFindings(client, pr, findingsOf(pr));
  assert.equal(again.created, 0);
  assert.equal(again.updated, 2);
  assert.equal(again.withdrawn, 0);
  assert.deepEqual([...new Set(again.items.map(row => row.canonical))], [ids[1]]);
  assert.ok(again.items.every(row => row.verdict === 'refuse'));
  await importFindings(client, pr, [...findingsOf(pr), ...findingsOf(pr)]);
  assert.equal((await findingLineage(client, ids[0]) as LineageView).observations.length, 2);
  assert.equal((await lineageItems(client)).filter(row => row.review_verdict_source === 'local').length, 1);
  const canonical = (await lineageItems(client)).find(row => row.id === ids[1])!;
  const removed = pr.threads.find(row => row.id === canonical.review_node_id)!;
  pr.threads = pr.threads.filter(row => row !== removed);
  const removal = await importFindings(client, pr, findingsOf(pr), { snapshotComplete: true });
  assert.equal(removal.withdrawn, 1);
  const repeatedRemoval = await importFindings(client, pr, findingsOf(pr), { snapshotComplete: true });
  assert.equal(repeatedRemoval.withdrawn, 0);
  const withdrawn = await findingLineage(client, ids[1]) as LineageView;
  assert.equal(withdrawn.observations.find(row => row.id === ids[1])!.withdrawn, true);
  assert.equal(withdrawn.disposition.reason, 'The existing validation already covers this boundary');
  assert.ok((await client.comments(ids[1])).comments.some(row => row.text.includes(withdrawn.disposition.reason)));
  pr.threads.push(removed);
  removed.comments[0].head = 'd'.repeat(40);
  removed.comments[0].body += '\nRevised observation preserves the earlier audit history.';
  await importFindings(client, pr, findingsOf(pr));
  const restored = await findingLineage(client, ids[0]) as LineageView;
  assert.equal(restored.observations.find(row => row.id === ids[1])!.withdrawn, false);
  assert.equal(restored.observations.find(row => row.id === ids[1])!.revision, 'd'.repeat(40));
  assert.equal(restored.disposition.reason, withdrawn.disposition.reason);
});

test('typed refusals guard identity, confirmation hashes, reasons and conflicting historical decisions', async t => {
  const { client, ids } = await fixture(t);
  refused(await findingLineage(client, 'missing'), 'finding_missing');
  refused(await findingLineage(client, ids[0], { with: 'missing' }), 'finding_missing');
  refused(await findingLineage(client, ids[0], { with: ids[0] }), 'link_invalid');
  refused(await findingLineage(client, ids[0], { confirm: true }), 'link_invalid');
  const options = { with: ids[1], confirm: true, reason: 'These observations describe the same validation boundary' };
  refused(await findingLineage(client, ids[0], options), 'revision_changed');
  const revision = (await findingLineage(client, ids[0], options) as { revision?: string }).revision;
  assert.equal(revision, undefined);
  const proposal = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
  for (const reason of [undefined, 'short', 'x'.repeat(1001)]) refused(await findingLineage(client, ids[0], { ...options, revision: proposal.revision, reason }), 'reason_required');
  await client.update(ids[1], { description: 'Changed observation text makes a prior proposal stale' });
  refused(await findingLineage(client, ids[0], { ...options, revision: proposal.revision }), 'revision_changed');
  const raw = await lineageItems(client);
  await recordVerdict(client, raw.find(row => row.id === ids[1])!, 'refuse', 'Independent reasoning must never be silently discarded', '');
  for (const fields of [{ review_reason: 'Legacy decision reason', review_commit: '' }, { review_reason: '', review_commit: 'f'.repeat(40) }]) {
    await client.update(ids[1], fieldOptions({ review_verdict_source: 'import', ...fields }));
    const legacy = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
    refused(await findingLineage(client, ids[0], { ...options, revision: legacy.revision }), 'disposition_conflict');
  }
  await recordVerdict(client, raw.find(row => row.id === ids[1])!, 'refuse', 'Independent reasoning must never be silently discarded', '');
  const current = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
  refused(await findingLineage(client, ids[0], { ...options, revision: current.revision }), 'disposition_conflict');
  await recordVerdict(client, raw.find(row => row.id === ids[0])!, 'refuse', 'Independent reasoning must never be silently discarded', '');
  assert.equal((await confirm(client, ids[0], ids[1])).observations.length, 2);
  assert.ok((await client.comments(ids[1])).comments.some(row => row.text.includes('Independent reasoning')));
});

test('confirmed components converge across cycles, reversed links and additional providers without merging proposals', async t => {
  const { client, ids } = await fixture(t);
  const third = (await client.create({ type: 'ReviewFinding', title: 'Third provider observation' })).item;
  const unclassified = await findingLineage(client, third.id) as LineageView;
  assert.equal(unclassified.disposition.verdict, 'pending');
  assert.equal(unclassified.observations[0].provider, 'unknown');
  assert.equal(unclassified.observations[0].revision, '');
  assert.equal(unclassified.observations[0].url, '');
  await client.update(third.id, fieldOptions({ review_node_id: 'third', review_verdict: 'pending' }));
  await confirm(client, ids[0], ids[1]);
  await confirm(client, ids[1], third.id);
  const group = await findingLineage(client, third.id) as LineageView;
  assert.equal(group.observations.length, 3);
  await client.comments(ids[1], { add: 'review-lineage/v1 ' + JSON.stringify({ with: ids[0], revision: group.revision, reason: 'Reverse confirmation retains the same connected identity' }) });
  const result = await findingLineage(client, ids[1]) as LineageView;
  assert.equal(result.canonical, third.id);
  assert.equal(result.observations.length, 3);
  assert.equal(result.disposition.verdict, 'pending');
  assert.equal(result.disposition.reason, '');
  assert.equal(result.disposition.commit, '');
});

test('malformed lineage records are skipped with typed diagnostics; unrelated comments are ignored', async t => {
  const { client, ids } = await fixture(t);
  await client.comments(ids[0], { add: 'Related candidate from pm-jev; no confirmation is implied.' });
  assert.equal((await findingLineage(client, ids[0]) as LineageView).observations.length, 1);
  const raw = await lineageItems(client);
  const base = raw[0];
  const valid = { with: raw[1].id, revision: 'a'.repeat(64), reason: 'Same input validation defect across providers' };
  const invalid: unknown[] = ['{', null, 1, {}, { ...valid, with: 1 }, { ...valid, with: 'absent' }, { ...valid, with: base.id }, { ...valid, revision: 1 }, { ...valid, revision: 'bad' }, { ...valid, reason: 1 }, { ...valid, reason: '' }, { ...valid, reason: 'x'.repeat(1001) }];
  for (const row of invalid) {
    const text = 'review-lineage/v1 ' + (row === '{' ? row : JSON.stringify(row));
    const issues: LineageIssue[] = [];
    assert.equal(lineageGroups([{ ...base, comments: [{ text, author: 'test-agent', created_at: '2026-10-22' }] }, raw[1]], issues).size, 2);
    assert.equal(issues.length, 1);
  }
  const attributionIssues: LineageIssue[] = [];
  lineageGroups([{ ...base, comments: [{ text: 'review-lineage/v1 ' + JSON.stringify(valid), author: '', created_at: '2026-10-22' }] }, raw[1]], attributionIssues);
  lineageGroups([{ ...base, comments: [{ text: 'review-lineage/v1 ' + JSON.stringify(valid), author: 'test-agent', created_at: '' }] }, raw[1]], attributionIssues);
  assert.equal(attributionIssues.length, 2);
  const withoutComments = { ...base };
  delete withoutComments.comments;
  assert.equal(canonicalReviewItems([withoutComments])[0].review_canonical, base.id);
  await client.comments(ids[0], { add: 'review-lineage/v1 {' });
  assert.equal((await findingLineage(client, ids[0]) as LineageView).issues![0].code, 'lineage_invalid');
});

test('registered lineage CLI works without git, gives typed refusals and uses compact host TOON and JSON', async t => {
  const { client, ids, cwd, pmRoot } = await fixture(t);
  const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
  assert.deepEqual(activation.failed, []);
  const sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
  const read = await runRegisteredCommandForTest(activation.commands, { command: 'review lineage', args: [ids[0]], options: { with: ids[1] }, pmRoot, sdk });
  assert.equal((read.result as LineageView).proposal!.confirmed, false);
  const refusedCommand = await runRegisteredCommandForTest(activation.commands, { command: 'review lineage', args: [], options: { confirm: true }, pmRoot, sdk });
  refused(refusedCommand.result as LineageResult, 'finding_missing');
  assert.equal((refusedCommand.result as { exit_code: number }).exit_code, 1);
  const stale = await runRegisteredCommandForTest(activation.commands, { command: 'review lineage', args: [ids[0]], options: { with: ids[1], confirm: true, revision: 'stale', reason: 'Confirm the same reviewed validation defect' }, pmRoot, sdk });
  refused(stale.result as LineageResult, 'revision_changed');
  const executableDir = join(cwd, 'bin');
  await mkdir(executableDir);
  await symlink(process.execPath, join(executableDir, 'node'));
  const entry = join(import.meta.dirname, '../node_modules/@unbrained/pm-cli/dist/cli.js');
  const packageSource = join(cwd, 'package-source');
  await mkdir(packageSource);
  await cp(join(import.meta.dirname, '../dist'), join(packageSource, 'dist'), { recursive: true });
  for (const file of ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) await copyFile(join(import.meta.dirname, '..', file), join(packageSource, file));
  await inFixtureWorkspace(cwd, () => client.packageInstall(packageSource, { project: true }));
  await inFixtureWorkspace(cwd, async () => {
    const env = { ...process.env, PATH: executableDir, GIT_CEILING_DIRECTORIES: dirname(cwd), PM_PATH: pmRoot, PM_AUTHOR: 'test-agent' };
    const pair = spawnSync(process.execPath, [entry, '--path', pmRoot, 'review', 'lineage', ids[0], '--with', ids[1], '--json'], { cwd, encoding: 'utf8', env });
    assert.equal(pair.status, 0, pair.stdout + pair.stderr);
    const proposal = JSON.parse(pair.stdout) as LineageView;
    const confirmed = spawnSync(process.execPath, [entry, '--path', pmRoot, 'review', 'lineage', ids[0], '--with', ids[1], '--confirm', '--revision', proposal.revision, '--reason', 'Confirm the same reviewed validation defect without git', '--json'], { cwd, encoding: 'utf8', env });
    assert.equal(confirmed.status, 0, confirmed.stdout + confirmed.stderr);
    assert.equal((JSON.parse(confirmed.stdout) as LineageView).observations.length, 2);
    await client.comments(ids[0], { add: 'review-lineage/v1 {' });
    for (const json of [false, true]) {
      const args = [entry, '--path', pmRoot, 'review', 'lineage', ids[0], ...(json ? ['--json'] : [])];
      const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, PATH: executableDir, GIT_CEILING_DIRECTORIES: dirname(cwd), PM_PATH: pmRoot, PM_AUTHOR: 'test-agent' } });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      if (json) {
        const view = JSON.parse(run.stdout) as LineageView;
        assert.equal(view.observations.length, 2);
        assert.equal(view.issues![0].kind, 'malformed');
      }
      else assert.match(run.stdout, /canonical:/);
      assert.ok(Buffer.byteLength(run.stdout) < 2200, run.stdout);
      assert.doesNotMatch(run.stdout, /description|Both observations identify/);
    }
  });
});
