import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PmClient, commitImportedItem, getHistoryPath, locateItem, readHistoryEntries, readLocatedItem, readSettings } from '@unbrained/pm-cli/sdk';
import type { GetOptions } from '@unbrained/pm-cli/sdk';
import { captureReviewScope, carryForwardReview } from '../src/scope.ts';
import type { CarryForwardReport } from '../src/scope-types.ts';
import { scopeFixture, scopeDenied } from './scope-fixture.ts';
import { inFixtureWorkspace } from './helpers.ts';

/** Instrument real SDK reads; every value and competing transition still comes from the real tracker. */
function interleave(client: PmClient, boundary: number, transition: () => Promise<void>) {
  let steps = 0;
  const trace: string[] = [];
  const observed = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'get') return Reflect.get(target, property, receiver);
      return async (id: string, options?: GetOptions) => {
        if (steps++ === boundary) await transition();
        trace.push(`${id}:${options?.at ?? 'current'}`);
        try { return await target.get(id, options); }
        finally { if (steps++ === boundary) await transition(); }
      };
    },
  });
  return { observed, trace, steps: () => steps };
}

test('peer transitions at every SDK read boundary preserve peer state and report observed attention conservatively', async t => {
  const { client, id, evidence, selection, cwd, pmRoot } = await scopeFixture(t);
  const peer = new PmClient({ cwd, pmRoot, author: 'peer-agent', noExtensions: true });
  const baseline = await captureReviewScope(client, id, selection);
  const dry = interleave(client, -1, async () => {});
  await carryForwardReview(dry.observed, id, baseline);
  const boundaries = dry.steps();
  // This includes historical reconstruction, each current read, successor probes, and both passes.
  assert.equal(boundaries, 16);
  for (const subject of ['evidence', 'artifact']) for (let boundary = 0; boundary <= boundaries; boundary++) {
    const sourceVersion = (await readHistoryEntries(getHistoryPath(pmRoot, evidence), evidence)).length;
    const artifactVersion = (await readHistoryEntries(getHistoryPath(pmRoot, id), id)).length;
    const fresh = structuredClone(selection);
    fresh.version = artifactVersion;
    fresh.obligations[0].evidence[0].version = sourceVersion;
    const currentBaseline = await captureReviewScope(client, id, fresh);
    const before = (await peer.get(subject === 'evidence' ? evidence : id, { full: true })).item;
    let transitioned = false;
    const description = `Peer committed ${subject} transition ${boundary}`;
    const probe = interleave(client, boundary, async () => {
      transitioned = true;
      await peer.update(subject === 'evidence' ? evidence : id, { description, assignee: 'peer-agent' });
      await peer.comments(id, { add: `foreign-provider/v1 ${description}` });
    });
    const result = await carryForwardReview(probe.observed, id, JSON.parse(JSON.stringify(currentBaseline)));
    if (result.ok) {
      assert.equal(result.approval, 'unverified');
      assert.ok(result.counts.stale === 0 || result.counts.stale === 1);
      assert.equal(result.counts.unchanged + result.counts.stale, 2);
      assert.equal(result.consistency, 'observed');
    } else assert.equal(result.refusal.code, 'state_changed');
    const after = (await peer.get(subject === 'evidence' ? evidence : id, { full: true })).item;
    if (transitioned) {
      assert.equal(after.description, description);
      assert.equal(after.assignee, 'peer-agent');
      assert.ok((await peer.get(id, { full: true })).item.comments!.some(row => row.text === `foreign-provider/v1 ${description}`));
    } else assert.deepEqual(after, before);
    // Replay of the original scope never turns a peer's successor into fresh attention.
    const replayed = await carryForwardReview(client, id, baseline) as CarryForwardReport;
    if (subject === 'evidence' && transitioned) assert.equal(replayed.counts.stale, 1);
  }
  const captureDry = interleave(client, -1, async () => {});
  await captureReviewScope(captureDry.observed, id, selection);
  for (let boundary = 0; boundary <= captureDry.steps(); boundary++) {
    const probe = interleave(client, boundary, async () => { await peer.update(id, { description: `Peer capture transition ${boundary}` }); });
    assert.deepEqual(await captureReviewScope(probe.observed, id, selection), baseline);
  }
  const report = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.equal(report.approval, 'unverified');
  t.diagnostic(`comparison: ${boundaries + 1} boundaries for each of artifact and evidence (${2 * (boundaries + 1)} cases); capture: ${captureDry.steps() + 1} boundaries; one non-git tracker, two real SDK clients; no shared mutation paths`);
});


test('an evidence successor followed by a byte-identical old import between passes refuses retention', async t => {
  const { client, id, evidence, selection, cwd, pmRoot } = await scopeFixture(t);
  const peer = new PmClient({ cwd, pmRoot, author: 'peer-agent', noExtensions: true });
  const located = (await locateItem(pmRoot, evidence))!;
  const document = (await readLocatedItem(located)).document;
  const settings = await readSettings(pmRoot);
  const before = (await client.get(evidence, { full: true })).item;
  const baseline = await captureReviewScope(client, id, selection);
  let replayed = false;
  const observed = new Proxy(client, { get(target, key, receiver) {
    if (key !== 'get') return Reflect.get(target, key, receiver);
    return async (...args: Parameters<PmClient['get']>) => {
      try { return await target.get(...args); }
      finally {
        if (!replayed && args[0] === evidence && args[1]?.at === '2') {
          replayed = true;
          await peer.update(evidence, { description: 'Competing evidence review successor' });
          await inFixtureWorkspace(cwd, async () => commitImportedItem({ pmRoot, id: evidence, itemPath: located.itemPath, document, settings, author: 'peer-agent', message: 'Replay older evidence input', conflictWarningPrefix: 'scope-replay' }));
        }
      }
    };
  } });
  scopeDenied(await carryForwardReview(observed, id, baseline), 'state_changed');
  assert.equal(replayed, true);
  assert.deepEqual((await client.get(evidence, { full: true })).item, before, 'ABA regression requires identical SDK values after replay');
  assert.equal((await readHistoryEntries(getHistoryPath(pmRoot, evidence), evidence)).length, 3);
  const current = await carryForwardReview(client, id, baseline) as CarryForwardReport;
  assert.deepEqual(current.counts, { unchanged: 1, stale: 1, never_reviewed: 1, removed: 0 });
  assert.equal(current.approval, 'unverified');
});
