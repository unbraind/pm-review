import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { PmClient } from '@unbrained/pm-cli/sdk';

test('the complete tracked corpus has unique GitHub import identities and preserves shared delivery evidence', async () => {
  const cwd = resolve(import.meta.dirname, '..');
  const client = new PmClient({ cwd, pmRoot: resolve(cwd, '.agents/pm'), noExtensions: true });
  const corpus = await client.listAllComplete();
  const owners = new Map<string, string>();
  for (const item of corpus.items) {
    for (const tag of item.tags ?? []) {
      const match = /^gh:([^#\s]+)#(\d+)$/.exec(tag.trim());
      if (!match) continue;
      const key = `${match[1].toLowerCase()}#${Number(match[2])}`;
      assert.ok(!owners.has(key) || owners.get(key) === item.id, `Duplicate importer identity ${key}: ${owners.get(key)} and ${item.id}`);
      owners.set(key, item.id);
    }
  }
  for (const id of ['pm-review-bun-closeout-copy', 'pm-review-targeted-evidence-requests']) {
    const item = corpus.items.find(row => row.id === id)!;
    assert.equal(item.status, 'closed');
    assert.ok(item.tags?.includes('delivery:unbraind/pm-review#46'));
    assert.ok(!item.tags?.includes('gh:unbraind/pm-review#46'));
    assert.match(item.close_reason!, /Delivered by merged PR #46/);
    assert.equal(item.completed_at, '2026-10-27T01:25:39.000Z');
  }
});
