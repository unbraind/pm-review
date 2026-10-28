import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';
import type { GetOptions, PmActionName, PmClientRunArgs } from '@unbrained/pm-cli/sdk';
import { reviewConflicts } from '../src/conflicts.ts';
import { fieldOptions } from '../src/tracker.ts';
import { conflictFixture, conflictPacket } from './conflict-fixture.ts';

/** Inject one real peer transition around each SDK operation; no SDK state is mocked. */
function boundaries(client: PmClient, at: number, transition: () => Promise<void>) {
  let steps = 0;
  /** Keep the actual SDK call inside the two injection boundaries. */
  async function around<T>(action: () => Promise<T>): Promise<T> {
    if (steps++ === at) await transition();
    try { return await action(); } finally { if (steps++ === at) await transition(); }
  }
  const observed = new Proxy(client, { get(target, key, receiver) {
    if (key === 'get') return (id: string, options?: GetOptions) => around(() => target.get(id, options));
    if (key === 'run') return (action: PmActionName, args?: PmClientRunArgs) => around(() => target.run(action, args));
    if (key === 'listAllComplete') return () => around(() => target.listAllComplete());
    return Reflect.get(target, key, receiver);
  } });
  return { observed, steps: () => steps };
}

test('every observation boundary preserves peer verdict, A-B-A, scope and lineage changes on one non-git tracker', async t => {
  const { client, cwd, pmRoot, input, ids } = await conflictFixture(t);
  const peer = new PmClient({ cwd, pmRoot, author: 'peer-agent', noExtensions: true });
  const dry = boundaries(client, -1, async () => {});
  conflictPacket(await reviewConflicts(dry.observed, input));
  const count = dry.steps();
  let cases = 0;
  for (const kind of ['verdict', 'aba', 'scope', 'lineage', 'retype', 'anchor-scope', 'anchor-retype']) for (let step = 0; step <= count; step++) {
    await peer.update(ids[0], { ...fieldOptions({ review_repo: 'example/package' }), type: 'ReviewFinding' });
    await peer.update(ids[1], { ...fieldOptions({ review_verdict: 'refuse', review_head: input.revision }), type: 'ReviewFinding' });
    const description = (await peer.get(ids[1], { full: true })).item.description;
    let ran = false;
    const probe = boundaries(client, step, async () => {
      ran = true;
      if (kind === 'verdict') await peer.update(ids[1], fieldOptions({ review_verdict: 'fix' }));
      if (kind === 'aba') { await peer.update(ids[1], { description: `Peer intermediate ${cases}` }); await peer.update(ids[1], { description }); }
      if (kind === 'scope') await peer.update(ids[1], fieldOptions({ review_head: 'peer-revision' }));
      if (kind === 'lineage') await peer.comments(ids[0], { add: `review-lineage/v1 {"with":"absent-${cases}","revision":"${'a'.repeat(64)}","reason":"A peer records an unavailable observation"}` });
      if (kind === 'retype') await peer.update(ids[1], { type: 'Task' });
      if (kind === 'anchor-scope') await peer.update(ids[0], fieldOptions({ review_repo: 'peer/package' }));
      if (kind === 'anchor-retype') await peer.update(ids[0], { type: 'Task' });
    });
    const result = await reviewConflicts(probe.observed, input);
    if (result.ok) { assert.equal(result.resolution, 'unverified'); assert.equal(result.consistency, 'observed'); }
    else assert.ok(['state_changed', 'finding_unavailable'].includes(result.refusal.code));
    if (ran && kind === 'verdict') assert.equal((await peer.get(ids[1], { full: true })).item.review_verdict, 'fix');
    if (ran && kind === 'scope') assert.equal((await peer.get(ids[1], { full: true })).item.review_head, 'peer-revision');
    if (ran && kind === 'retype') assert.equal((await peer.get(ids[1], { full: true })).item.type, 'Task');
    cases++;
  }
  t.diagnostic(`${count + 1} boundaries x 7 real competing transitions = ${cases} cases; no leases, claims, outboxes or shared budget are created`);
});

test('random custom workflow roles and ambient focus cannot settle judgments or alter native relationships', async t => {
  const { client, input, ids } = await conflictFixture(t);
  const parent = (await client.create({ type: 'Epic', title: 'Synthetic ambient focus', parent: 'none' })).item;
  await client.focus(parent.id);
  let seed = 0x1028;
  for (let index = 0; index < 16; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const role = ['active', 'blocked', 'terminal_done', 'terminal_canceled'][index % 4];
    const status = (await client.schemaAddStatus(`custom-${seed}`, { role: [role] })).status.id;
    await client.update(ids[index % 2], { status, ...(index % 4 > 1 ? { closeReason: 'Synthetic workflow transition' } : {}) });
    const before = await client.get(ids[0], { full: true });
    assert.equal(conflictPacket(await reviewConflicts(client, input)).state, 'conflict');
    assert.deepEqual(await client.get(ids[0], { full: true }), before);
  }
});
