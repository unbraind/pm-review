import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';
import type { GetOptions, PmActionName, PmClientRunArgs } from '@unbrained/pm-cli/sdk';
import { reviewEvidenceRequests } from '../src/requests.ts';
import { requestSnapshot } from '../src/requests-state.ts';
import { requestsFixture, queue } from './requests-fixture.ts';

/** Wrap real SDK operations to inject a competing writer before and after every observation step. */
function interleave(client: PmClient, boundary: number, transition: () => Promise<void>) {
  let steps = 0;
  const observed = new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'get') return async (id: string, options?: GetOptions) => {
        if (steps++ === boundary) await transition();
        try { return await target.get(id, options); } finally { if (steps++ === boundary) await transition(); }
      };
      if (property === 'run') return async (action: PmActionName, args?: PmClientRunArgs) => {
        if (steps++ === boundary) await transition();
        try { return await target.run(action, args); } finally { if (steps++ === boundary) await transition(); }
      };
      if (property === 'schemaList' || property === 'listAllComplete') return async () => {
        if (steps++ === boundary) await transition();
        try { return await target[property](); } finally { if (steps++ === boundary) await transition(); }
      };
      return Reflect.get(target, property, receiver);
    },
  });
  return { observed, steps: () => steps };
}

test('every SDK step boundary in finding and criterion queue paths tolerates competing target, evidence and registry writes on one non-git tracker', async t => {
  const { client, cwd, pmRoot, finding, evidence, packet } = await requestsFixture(t);
  const peer = new PmClient({ cwd, pmRoot, author: 'peer-agent', noExtensions: true });
  let expectedFindingStatus = (await peer.get(finding, { full: true })).item.status;
  let cases = 0;
  for (const selected of packet.select) {
    const selection = { ...packet, select: [selected] };
    const first = queue(await reviewEvidenceRequests(client, selection));
    const dryArrival = { request: first.requests[0].key, item: evidence, version: (await requestSnapshot(client, evidence))!.version, field: selected.missing === 'source' ? 'files' : 'tests', index: 0 };
    const dry = interleave(client, -1, async () => {});
    await reviewEvidenceRequests(dry.observed, { ...selection, arrivals: [dryArrival] });
    const boundaries = dry.steps();
    for (const subject of ['target', 'evidence', 'registry']) for (let boundary = 0; boundary <= boundaries; boundary++) {
      const fresh = queue(await reviewEvidenceRequests(client, selection));
      const arrival = { request: fresh.requests[0].key, item: evidence, version: (await requestSnapshot(client, evidence))!.version, field: selected.missing === 'source' ? 'files' : 'tests', index: 0 };
      let transitioned = false;
      let addedStatus = '';
      const description = `Peer ${subject} ${cases}`;
      const probe = interleave(client, boundary, async () => {
        transitioned = true;
        if (subject === 'registry') {
          addedStatus = (await peer.schemaAddStatus(`custom-${cases}`, { role: ['active'] })).status.id;
          await peer.update(selected.item, { status: addedStatus });
          if (selected.item === finding) expectedFindingStatus = addedStatus;
        }
        else await peer.update(subject === 'target' ? selected.item : evidence, { description });
      });
      const result = await reviewEvidenceRequests(probe.observed, { ...selection, arrivals: [arrival] });
      if (result.ok) {
        assert.equal(result.consistency, 'observed');
        assert.equal(result.approval, 'unverified');
        assert.equal(result.pending + result.satisfied.length + result.skipped.length, 1);
      } else assert.equal(result.refusal.code, 'state_changed');
      if (transitioned && subject !== 'registry') assert.equal((await peer.get(subject === 'target' ? selected.item : evidence, { full: true })).item.description, description);
      if (transitioned && subject === 'registry') assert.ok((await peer.schemaList()).statuses.custom.some(row => row.id === addedStatus));
      cases++;
    }
    t.diagnostic(`${selected.obligation}: ${boundaries + 1} boundaries per competing transition`);
  }
  assert.ok(cases > 100);
  // No mutation path exists: the queue never claims, leases, decrements shared budgets or deletes records.
  assert.equal((await client.get(finding, { full: true })).item.status, expectedFindingStatus);
  t.diagnostic(`${cases} real interleavings; one non-git tracker; target, evidence and status registry transitions preserved`);
});

test('random custom registry identifiers use active, blocked, done and canceled roles regardless of spelling', async t => {
  const { client, packet } = await requestsFixture(t);
  let state = 0x501e1026;
  for (let index = 0; index < 20; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const role = ['active', 'blocked', 'terminal_done', 'terminal_canceled'][state % 4];
    const status = `status-${state.toString(36)}`;
    await client.schemaAddStatus(status, { role: [role] });
    const terminal = role === 'terminal_done' || role === 'terminal_canceled';
    const finding = (await client.create({ type: 'ReviewFinding', title: `Custom workflow ${index}`, status, ...(terminal ? { closeReason: 'Synthetic terminal review obligation' } : {}) })).item.id;
    const result = queue(await reviewEvidenceRequests(client, { ...packet, select: [{ item: finding, obligation: 'finding', missing: 'test' }] }));
    assert.equal(result.pending, terminal ? 0 : 1);
    assert.deepEqual(result.skipped.map(row => row.reason), terminal ? ['obligation_terminal'] : []);
  }
});
