import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewEvidenceRequests } from '../src/requests.ts';
import { requestsFixture, queue, requestsDenied, reviewedRequestGap } from './requests-fixture.ts';

test('a peer invalidating coverage evidence between obligation observations yields a typed retry', async t => {
  const { client, gap, packet } = await requestsFixture(t);
  const { source } = await reviewedRequestGap(client, gap);
  let scans = 0;
  /** Return a real certified read while a peer invalidates its provenance before the next observation. */
  async function scanCoverage() {
    const snapshot = await client.listAllComplete();
    if (scans++ === 0) await client.update(source, { description: 'A peer revised the original coverage source.' });
    return snapshot;
  }
  const observed = new Proxy(client, {
    get(target, property, receiver) {
      return property === 'listAllComplete' ? scanCoverage : Reflect.get(target, property, receiver);
    },
  });
  requestsDenied(await reviewEvidenceRequests(observed, { ...packet, select: [packet.select[1]] }), 'state_changed');
  assert.equal((await client.get(source, { full: true })).item.description, 'A peer revised the original coverage source.');
});

test('caller mutation after the single validation boundary cannot change the running packet', async t => {
  const { client, packet } = await requestsFixture(t);
  const observed = new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'schemaList') return Reflect.get(target, property, receiver);
      return async () => {
        packet.select.length = 0;
        packet.budget.requests = 0;
        return target.schemaList();
      };
    },
  });
  const result = queue(await reviewEvidenceRequests(observed, packet));
  assert.equal(result.requests.length, 2);
  assert.equal(result.total, 2);
  assert.equal(packet.select.length, 0);
});
