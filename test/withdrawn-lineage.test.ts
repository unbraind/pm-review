import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { findingsOf } from '../src/findings.ts';
import { findingLineage, lineageItems } from '../src/lineage.ts';
import type { LineageView } from '../src/lineage.ts';
import { respond, responsePlan, reviewStatus } from '../src/respond.ts';
import { importFindings, recordVerdict, reviewItems } from '../src/tracker.ts';
import { lineageFixture, syntheticTransport } from './helpers.ts';

for (const verdict of ['fix', 'refuse'] as const) for (const ownerWithdrawn of [true, false]) {
  test(`withdrawn lineage keeps live sibling responses usable: ${verdict}, ${ownerWithdrawn ? 'canonical' : 'noncanonical'} withdrawn`, async t => {
    const previousPath = process.env.PATH;
    const previousCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.PATH = '';
    process.env.GIT_CEILING_DIRECTORIES = tmpdir();
    t.after(() => {
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
      if (previousCeiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previousCeiling;
    });
    const { client, pr, ids } = await lineageFixture(t);
    const proposal = await findingLineage(client, ids[0], { with: ids[1] }) as LineageView;
    const confirmed = await findingLineage(client, ids[0], { with: ids[1], confirm: true, revision: proposal.revision, reason: 'Both providers identify the same unchecked input boundary' }) as LineageView;
    assert.equal(confirmed.observations.length, 2);
    const withdrawnId = ids[1];
    const liveId = ids[0];
    const ownerId = ownerWithdrawn ? withdrawnId : liveId;
    const reason = 'The shared boundary was assessed using retained source evidence';
    const commit = verdict === 'fix' ? 'c'.repeat(40) : '';
    // The issue's exact scenario decides only B; the noncanonical variant also decides A later.
    for (const id of ownerWithdrawn ? [withdrawnId] : [withdrawnId, liveId]) await recordVerdict(client, (await lineageItems(client)).find(item => item.id === id)!, verdict, reason, commit);
    const before = (await lineageItems(client)).find(item => item.id === withdrawnId)!;
    const removed = pr.threads.find(thread => thread.id === before.review_thread_id)!;
    pr.threads = pr.threads.filter(thread => thread.id !== removed.id);
    const transport = syntheticTransport(pr);

    // A partial/default import cannot certify withdrawal or bypass the missing-source guard.
    const partial = await importFindings(client, pr, findingsOf(pr));
    assert.equal(partial.withdrawal_checked, false);
    assert.equal(partial.withdrawn, 0);
    assert.throws(() => responsePlan(pr, [before], 'author', {}), /thread is missing/);
    await assert.rejects(respond(client, transport, pr.repo, pr.number), /thread is missing/);
    await assert.rejects(reviewStatus(client, transport, pr.repo, pr.number), /thread is missing/);

    const receipt = await importFindings(client, pr, findingsOf(pr), { snapshotComplete: true });
    assert.equal(receipt.withdrawn, 1);
    assert.equal(receipt.withdrawal_checked, true);
    const items = await reviewItems(client);
    assert.ok(items.every(item => item.review_canonical === ownerId && item.review_verdict === verdict));
    const retained = (await lineageItems(client)).find(item => item.id === withdrawnId)!;
    assert.equal(retained.review_withdrawn, true);
    for (const key of ['description', 'review_reason', 'review_commit', 'comments'] as const) assert.deepEqual(retained[key], before[key]);
    const plan = responsePlan(pr, items, 'author', { resolve: true });
    assert.deepEqual(plan.withdrawn_items, [withdrawnId]);
    assert.deepEqual(plan.missingReplies, [liveId]);
    assert.deepEqual(plan.missingVerdicts, []);
    assert.deepEqual(plan.actions.map(action => action.kind), ['reply', 'resolve']);
    assert.equal(plan.actions.find(action => action.kind === 'reply')!.finding, liveId);
    const dry = await respond(client, transport, pr.repo, pr.number);
    assert.deepEqual(dry.withdrawn_items, [withdrawnId]);
    assert.equal(dry.actions.length, 1);
    assert.deepEqual(transport.calls, []);
    const status = await reviewStatus(client, transport, pr.repo, pr.number);
    assert.deepEqual(status.withdrawn_items, [withdrawnId]);
    assert.deepEqual(status.verdicts_without_reply, [liveId]);
    assert.deepEqual(status.findings_without_verdict, []);
    // Withdrawn pending records must not become missing-verdict blockers either.
    assert.deepEqual(responsePlan(pr, [{ ...retained, review_verdict: 'pending' }], 'author', {}).missingVerdicts, []);

    await respond(client, transport, pr.repo, pr.number, { apply: true, resolve: true });
    assert.deepEqual(transport.calls, ['reply', 'resolve']);
    assert.deepEqual((await respond(client, transport, pr.repo, pr.number)).actions, []);
    assert.deepEqual((await reviewStatus(client, transport, pr.repo, pr.number)).verdicts_without_reply, []);
    pr.threads.push(removed);
    await importFindings(client, pr, findingsOf(pr), { snapshotComplete: true });
    assert.equal((await client.get(withdrawnId)).item.review_withdrawn, false);
    const reappeared = await respond(client, transport, pr.repo, pr.number);
    assert.equal(reappeared.withdrawn_items, undefined);
    assert.deepEqual(reappeared.actions.filter(action => action.kind === 'reply').map(action => action.finding), [withdrawnId]);
    await respond(client, transport, pr.repo, pr.number, { apply: true, resolve: true });
    assert.deepEqual((await respond(client, transport, pr.repo, pr.number)).actions, []);
    assert.deepEqual((await findingLineage(client, liveId) as LineageView).observations.map(row => row.id).sort(), ids);
    assert.equal((await findingLineage(client, liveId) as LineageView).canonical, ownerId);
  });
}
