import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { isPmCliExpectedError, PmClient } from '@unbrained/pm-cli/sdk';
import { findingLineage, lineageGroups, lineageItems } from '../src/lineage.ts';
import type { LineageResult, LineageView } from '../src/lineage.ts';
import { canonicalOf, decisionText, decisionTime, LINEAGE_PREFIX } from '../src/lineage-state.ts';
import { fieldOptions, importFindings, precedents, recordVerdict, reviewItems } from '../src/tracker.ts';
import { findingsOf } from '../src/findings.ts';
import { decide } from '../src/verdict.ts';
import { compactRound, evaluateRound } from '../src/round.ts';
import { respond, responsePlan, reviewStatus } from '../src/respond.ts';
import { inFixtureWorkspace, lineageFixture, syntheticTransport } from './helpers.ts';

/** Confirm a fresh pair using its exact current evidence revision. */
async function confirm(client: PmClient, id: string, other: string): Promise<LineageResult> {
  const proposal = await findingLineage(client, id, { with: other }) as LineageView;
  return findingLineage(client, id, { with: other, confirm: true, revision: proposal.revision, reason: 'Both providers describe the same validated input boundary' });
}

/** Append one deliberately corrupt or dangling record through the real comment pipeline. */
async function addLink(client: PmClient, id: string, other: string): Promise<void> {
  await client.comments(id, { add: LINEAGE_PREFIX + JSON.stringify({ with: other, revision: 'a'.repeat(64), reason: 'Retain this confirmation for an edge robustness regression' }) });
}

test('bad and dangling confirmations cannot disable import, verdict, round, response or precedent workflows', async t => {
  const { client, ids, pr } = await lineageFixture(t);
  await client.comments(ids[0], { add: LINEAGE_PREFIX + '{' });
  await addLink(client, ids[0], 'absent-review-finding');
  const removed = (await client.create({ type: 'ReviewFinding', title: 'Temporary deleted target' })).item;
  await addLink(client, ids[0], removed.id);
  await client.delete(removed.id);
  const changedType = (await client.create({ type: 'ReviewFinding', title: 'Temporary retyped target' })).item;
  await addLink(client, ids[0], changedType.id);
  await client.update(changedType.id, { type: 'Task' });
  const imported = await importFindings(client, pr, findingsOf(pr));
  assert.equal(imported.issues!.length, 4);
  assert.deepEqual(imported.issues!.map(issue => issue.kind), ['malformed', 'dangling', 'dangling', 'dangling']);
  assert.ok(imported.issues!.every(issue => issue.remedy.includes('skipped')));
  await recordVerdict(client, (await lineageItems(client)).find(row => row.id === ids[0])!, 'fix', 'Retained reasoning despite invalid confirmation records', 'c'.repeat(40));
  await decide(client, undefined, { id: ids[1], repo: pr.repo, pr: pr.number, apply: false, verdict: 'refuse', reason: 'Retained refusal despite invalid confirmation records', commit: '' });
  const items = await reviewItems(client);
  assert.equal(items.length, 2);
  assert.equal((items.find(row => row.id === ids[0])!.review_lineage_issues as unknown[]).length, 4);
  const round = evaluateRound(pr, items);
  assert.equal(round.pending_items.length, 0);
  assert.equal(round.issues!.length, 4);
  assert.match(compactRound(round), /lineage_issues=4/);
  assert.equal(responsePlan(pr, items, 'author', {}).issues!.length, 4);
  const transport = syntheticTransport(pr);
  assert.equal((await respond(client, transport, pr.repo, pr.number)).issues!.length, 4);
  assert.equal((await reviewStatus(client, transport, pr.repo, pr.number)).issues!.length, 4);
  assert.equal((await precedents(client, 'Retained')).length, 2);
  const view = await findingLineage(client, ids[0]) as LineageView;
  assert.equal(view.issues!.length, 4);
  assert.equal(view.observations.length, 1);
});

test('import-derived dispositions cannot be silently merged', async t => {
  const { client, ids, pr } = await lineageFixture(t);
  await client.update(ids[0], fieldOptions({ review_verdict: 'informational', review_verdict_source: 'import', review_reason: '', review_commit: '' }));
  await client.update(ids[1], fieldOptions({ review_verdict: 'fix', review_verdict_source: 'import', review_reason: '', review_commit: '' }));
  const result = await confirm(client, ids[0], ids[1]);
  assert.equal(result.ok, false, 'different import dispositions must refuse confirmation');
  if (!result.ok) assert.equal(result.refusal.code, 'disposition_conflict');
  assert.equal((await client.comments(ids[0])).comments.length, 0);
  assert.equal((await findingLineage(client, ids[0]) as LineageView).disposition.verdict, 'informational');
  assert.equal((await findingLineage(client, ids[1]) as LineageView).disposition.verdict, 'fix');
  const raw = await lineageItems(client);
  const rows = findingsOf(pr).map(row => ({ ...row, verdict: raw.find(item => item.review_node_id === row.id)!.review_verdict as 'fix' | 'informational' }));
  await importFindings(client, pr, rows);
  assert.ok((await lineageItems(client)).every(row => row.review_verdict_source === 'import'), 'explicit import decisions must not become local on refresh');
});

test('decision time owns canonical lineage and reverse or replay links expose later noncanonical decisions', async t => {
  const { client, ids } = await lineageFixture(t);
  await client.update(ids[0], fieldOptions({ review_decided_at: '2000-01-01T00:00:00Z' }));
  await client.update(ids[1], fieldOptions({ review_decided_at: '2001-01-01T00:00:00Z' }));
  const first = await confirm(client, ids[0], ids[1]) as LineageView;
  assert.equal(first.canonical, ids[1], 'newer decision wins even when its id sorts later');
  const raw = await lineageItems(client);
  const a = raw.find(row => row.id === ids[0])!;
  const b = raw.find(row => row.id === ids[1])!;
  await recordVerdict(client, b, 'fix', 'The shared input boundary was fixed', 'b'.repeat(40));
  await recordVerdict(client, a, 'refuse', 'A later reassessment supersedes the earlier fix decision', '');
  const replay = await findingLineage(client, ids[1], { with: ids[0], confirm: true }) as LineageView;
  assert.equal(replay.proposal!.confirmed, true);
  assert.equal(replay.canonical, ids[0]);
  assert.equal(replay.disposition.verdict, 'refuse');
  assert.equal(replay.disagreements!.find(row => row.id === ids[1])!.disposition.verdict, 'fix');
  await recordVerdict(client, b, 'fix', 'The shared input boundary was fixed', 'b'.repeat(40));
  const reasserted = await findingLineage(client, ids[0]) as LineageView;
  assert.equal(reasserted.canonical, ids[1]);
  assert.equal(reasserted.disposition.verdict, 'fix');
  assert.ok((await client.comments(ids[0])).comments.some(row => row.text.includes('later reassessment')));
});

test('changed import decisions advance decision time while repeat imports preserve it', async t => {
  const { client, ids, pr } = await lineageFixture(t);
  for (const thread of pr.threads) thread.comments[0].createdAt = '2000-01-01T00:00:00Z';
  await client.update(ids[0], fieldOptions({ review_decided_at: '2000-01-01T00:00:00Z' }));
  await client.update(ids[1], fieldOptions({ review_decided_at: '2001-01-01T00:00:00Z' }));
  assert.equal((await confirm(client, ids[0], ids[1]) as LineageView).canonical, ids[1]);
  const raw = (await lineageItems(client)).find(row => row.id === ids[0])!;
  pr.threads.find(thread => thread.id === raw.review_node_id)!.comments[0].body = 'Full review finished.';
  await importFindings(client, pr, findingsOf(pr));
  const changed = await findingLineage(client, ids[0]) as LineageView;
  assert.equal(changed.canonical, ids[0]);
  assert.equal(changed.disposition.verdict, 'informational');
  const timestamp = (await client.get(ids[0])).item.review_decided_at;
  assert.ok(Date.parse(String(timestamp)) > Date.parse('2001-01-01T00:00:00Z'), 'changed imported decisions must receive a fresh decision time');
  assert.equal((await client.get(ids[1])).item.review_decided_at, '2001-01-01T00:00:00Z', 'unchanged observations must retain their decision time');
  await importFindings(client, pr, findingsOf(pr));
  assert.equal((await client.get(ids[0])).item.review_decided_at, timestamp);
  assert.equal((await findingLineage(client, ids[1]) as LineageView).canonical, ids[0]);
});

test('verdict audit and fields commit atomically on the stable observation after a confirmation changes ownership', async t => {
  const { client, ids, cwd, pmRoot } = await lineageFixture(t);
  const stale = (await lineageItems(client)).find(row => row.id === ids[1])!;
  await confirm(client, ids[0], ids[1]);
  const folder = join(pmRoot, 'extensions', 'atomic-decision-guard');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'manifest.json'), JSON.stringify({ name: 'atomic-decision-guard', version: '1.0.0', entry: './index.ts', capabilities: ['hooks'] }));
  await writeFile(join(folder, 'index.ts'), `import type { ExtensionApi, BeforeMutationHookContext } from '@unbrained/pm-cli/sdk/authoring';
export default { activate(api: ExtensionApi): void {
  api.hooks.beforeMutation((ctx: BeforeMutationHookContext) => {
    const before = new Set((ctx.before?.metadata.comments ?? []).map(row => row.text));
    const added = (ctx.after?.metadata.comments ?? []).filter(row => !before.has(row.text) && row.text.startsWith('pm-review fix:'));
    if (added.length && (ctx.after?.metadata.review_verdict !== 'fix' || ctx.after.metadata.review_reason !== 'The decision and audit must land together' || ctx.after.metadata.review_commit !== '${'d'.repeat(40)}')) return { allow: false, code: 'split_decision_write', remediation: 'Commit audit and decision in the same SDK update.' };
    return { allow: true };
  });
} };`);
  const guarded = new PmClient({ cwd, pmRoot, author: 'test-agent' });
  const previousGlobal = process.env.PM_GLOBAL_PATH;
  process.env.PM_GLOBAL_PATH = join(cwd, 'isolated-global');
  try {
    await inFixtureWorkspace(cwd, () => recordVerdict(guarded, stale, 'fix', 'The decision and audit must land together', 'd'.repeat(40)));
  } finally {
    if (previousGlobal === undefined) delete process.env.PM_GLOBAL_PATH;
    else process.env.PM_GLOBAL_PATH = previousGlobal;
  }
  const written = (await client.get(ids[1], { full: true })).item;
  assert.equal(written.review_verdict, 'fix');
  assert.equal(written.comments!.filter(row => row.text.startsWith('pm-review fix:')).length, 1);
  assert.ok(Date.parse(String(written.review_decided_at)) > 0);
  assert.equal((await client.get(ids[0])).item.review_verdict, 'pending');
  assert.equal((await findingLineage(client, ids[0]) as LineageView).canonical, ids[1]);

});

test('missing observation verdict targets return typed remedies without partial writes', async t => {
  const { client } = await lineageFixture(t);
  const stale = (await lineageItems(client))[0];
  const before = JSON.stringify((await client.listAllComplete()).items);
  await assert.rejects(recordVerdict(client, { ...stale, id: 'missing-observation' }, 'fix', 'Missing observations refuse cleanly', ''), failure => isPmCliExpectedError(failure) && failure.code === 'finding_missing' && Boolean(failure.context.nextSteps?.length));
  await assert.rejects(decide(client, undefined, { id: 'missing-observation', repo: 'example/package', pr: 1, apply: false, verdict: 'refuse', reason: 'Refuse a missing observation with a typed remedy', commit: '' }), failure => isPmCliExpectedError(failure) && failure.code === 'finding_missing');
  assert.equal(JSON.stringify((await client.listAllComplete()).items), before);
});

test('filtered and one-provider imports cannot infer withdrawal without verified full snapshot coverage', async t => {
  const { client, ids, pr } = await lineageFixture(t);
  const all = findingsOf(pr);
  const subset = all.slice(0, 1);
  const partial = await importFindings(client, pr, subset);
  assert.equal(partial.withdrawn, 0, 'filtered imports must not withdraw other observations');
  assert.equal(partial.withdrawal_checked, false);
  const providerOnly = { ...pr, threads: pr.threads.slice(0, 1) };
  assert.equal((await importFindings(client, providerOnly, findingsOf(providerOnly))).withdrawn, 0);
  assert.ok((await lineageItems(client)).every(row => row.review_withdrawn === false));
  const before = JSON.stringify((await client.listAllComplete()).items);
  for (const rows of [subset, [{ ...all[0], body: 'A modified observation cannot certify the full snapshot' }, all[1]]]) {
    await assert.rejects(importFindings(client, pr, rows, { snapshotComplete: true }), failure => isPmCliExpectedError(failure) && failure.code === 'snapshot_incomplete');
  }
  assert.equal(JSON.stringify((await client.listAllComplete()).items), before, 'incomplete assertions refuse before writing');
  assert.equal((await importFindings(client, pr, [...all, ...all], { snapshotComplete: true })).withdrawal_checked, true);
  const empty = { ...pr, threads: [] };
  assert.equal((await importFindings(client, empty, [], { snapshotComplete: true })).withdrawn, 2);
  assert.equal((await importFindings(client, empty, [], { snapshotComplete: true })).withdrawn, 0);
  assert.equal((await findingLineage(client, ids[0]) as LineageView).observations[0].withdrawn, true);
  await importFindings(client, pr, all);
  assert.ok((await lineageItems(client)).every(row => row.review_withdrawn === false));
});

test('proposal revisions bind scoring titles and the complete comment set', async t => {
  const { client, ids } = await lineageFixture(t);
  const before = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
  const options = { with: ids[1], confirm: true, reason: 'Confirm only the exact observations that were inspected' };
  await client.update(ids[0], { title: 'A changed title changes the match score' });
  const staleTitle = await findingLineage(client, ids[0], { ...options, revision: before.revision });
  assert.equal(staleTitle.ok, false);
  if (!staleTitle.ok) assert.equal(staleTitle.refusal.code, 'revision_changed');
  const afterTitle = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
  await client.comments(ids[1], { add: 'Additional reasoning arrived after the proposal was read.' });
  const staleComment = await findingLineage(client, ids[0], { ...options, revision: afterTitle.revision });
  assert.equal(staleComment.ok, false);
  if (!staleComment.ok) assert.equal(staleComment.refusal.code, 'revision_changed');
  const final = await confirm(client, ids[0], ids[1]) as LineageView;
  assert.equal(final.observations.length, 2);
  assert.equal(final.canonical, before.proposal!.canonical, 'ordinary comments and title edits do not advance decision time');
});

test('decision dating handles legacy audit comments, absent times and equal-time ties', async t => {
  const { client } = await lineageFixture(t);
  const base = (await lineageItems(client))[0];
  const legacy = { ...base, review_decided_at: undefined, created_at: '2000-01-01T00:00:00Z', review_verdict: 'refuse', review_reason: 'Legacy decision evidence', review_commit: '', comments: undefined };
  assert.equal(decisionTime(legacy), Date.parse(legacy.created_at));
  assert.equal(decisionTime({ ...legacy, created_at: 'invalid' }), 0);
  const text = decisionText({ verdict: 'refuse', reason: 'Legacy decision evidence', commit: '' });
  const audited = { ...legacy, comments: [{ text, author: 'legacy-agent', created_at: '2001-01-01T00:00:00Z' }, { text, author: 'legacy-agent', created_at: 'invalid' }] };
  assert.equal(decisionTime(audited), Date.parse('2001-01-01T00:00:00Z'));
  const newer = { ...legacy, id: 'z-newer', review_decided_at: '2002-01-01T00:00:00Z' };
  assert.equal(canonicalOf([legacy, newer]).id, 'z-newer');
  assert.equal(canonicalOf([{ ...newer, id: 'z-tie' }, { ...newer, id: 'a-tie' }]).id, 'a-tie');
  assert.equal(lineageGroups([]).size, 0);
});
