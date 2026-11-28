import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { certifyCompleteListResult, PmClient } from '@unbrained/pm-cli/sdk';
import type { PmItem } from 'pm-github';
import { buildGithubOwnershipIndex, githubRepositoryHash } from 'pm-github/dist/import-ownership.js';

/** Enforce one claimant per issue using the same ownership rules as GitHub import. */
function assertUniqueImporterIdentities(items: readonly PmItem[]): void {
  const { claimants } = buildGithubOwnershipIndex(items);
  for (const [key, claim] of claimants) {
    const ids = [...claim.keys()];
    assert.ok(ids.length <= 1, `Duplicate importer identity ${key}: ${ids.join(' and ')}`);
  }
}

test('rejects two explicit owners of the same issue without reference tags', () => {
  assert.throws(() => assertUniqueImporterIdentities([
    { id: 'url-owner', github_url: 'https://github.com/Example/Project/issues/57/' },
    { id: 'number-owner', github_repo: 'example/project', github_number: 57 },
  ]), { message: 'Duplicate importer identity example/project#57: url-owner and number-owner' });
});

test('distinguishes a reference from a proven legacy importer ID', () => {
  const explicitOwner = { id: 'url-owner', github_url: 'https://github.com/example/project/issues/57' };
  const legacy = {
    id: `fixture-github-${githubRepositoryHash('example/project')}-57`,
    tags: ['gh:example/project#99'],
  };
  assert.doesNotThrow(() => assertUniqueImporterIdentities([explicitOwner, legacy]));
  assert.throws(() => assertUniqueImporterIdentities([explicitOwner, { ...legacy, author: 'pm-github' }]), {
    message: `Duplicate importer identity example/project#57: url-owner and ${legacy.id}`,
  });
});

test('the complete tracked corpus has unique GitHub import identities and preserves shared delivery evidence', async () => {
  const cwd = resolve(import.meta.dirname, '..');
  const client = new PmClient({ cwd, pmRoot: resolve(cwd, '.agents/pm'), noExtensions: true });
  const corpus = await client.listAllComplete();
  certifyCompleteListResult(corpus);
  assertUniqueImporterIdentities(corpus.items);
  for (const id of ['pm-review-bun-closeout-copy', 'pm-review-targeted-evidence-requests']) {
    const item = corpus.items.find(row => row.id === id)!;
    assert.equal(item.status, 'closed');
    assert.ok(item.tags?.includes('delivery:unbraind/pm-review#46'));
    assert.ok(!item.tags?.includes('gh:unbraind/pm-review#46'));
    assert.match(item.close_reason!, /Delivered by merged PR #46/);
    assert.equal(item.completed_at, '2026-10-27T01:25:39.000Z');
  }
});
