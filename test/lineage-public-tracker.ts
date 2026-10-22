/** Read-only validation against an exported public fleet tracker in a plain directory. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { findingLineage, lineageItems } from '../src/lineage.ts';
import type { LineageView } from '../src/lineage.ts';

const pmRoot = process.argv[2];
assert.ok(pmRoot, 'Pass an exported public tracker root');
/** Enumerate durable source artifacts, excluding disposable read caches. */
async function durableFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['cache', 'runtime', 'locks'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await durableFiles(path));
    else files.push(path);
  }
  return files.sort();
}
/** Fingerprint the exact original file set before and after all read-only SDK calls. */
async function fingerprint(files: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const file of files) hash.update(await readFile(file));
  return hash.digest('hex');
}
const files = await durableFiles(pmRoot);
const before = await fingerprint(files);
const client = new PmClient({ cwd: dirname(dirname(pmRoot)), pmRoot, noExtensions: true, author: 'lineage-validation' });
const all = (await client.listAllComplete()).items;
const items = await lineageItems(client);
const ids = new Set(items.map(item => item.id));
const duplicates = await client.duplicates({ threshold: 0.35, limit: 20 });
const pairs = duplicates.clusters.flatMap(cluster => cluster.matches).filter(pair => ids.has(pair.left_id) && ids.has(pair.right_id)).slice(0, 20);
const views: LineageView[] = [];
for (const item of items) {
  const result = await findingLineage(client, item.id);
  assert.equal(result.ok, true);
  views.push(result as LineageView);
}
for (const pair of pairs) {
  const proposal = await findingLineage(client, pair.left_id, { with: pair.right_id });
  assert.equal(proposal.ok, true);
  assert.equal((proposal as LineageView).proposal!.confirmed, false);
}
assert.equal(await fingerprint(files), before, 'Durable public tracker inputs changed during read-only validation');
console.log(JSON.stringify({ total_items: all.length, review_observations: items.length, providers: new Set(items.map(item => item.review_bot)).size, source_revisions: new Set(items.map(item => item.review_head).filter(Boolean)).size, canonical_dispositions: new Set(views.map(view => view.canonical)).size, core_candidate_clusters: duplicates.count, proposals_checked: pairs.length, proposals_unconfirmed: pairs.length, durable_files_unchanged: files.length, largest_json_bytes: Math.max(0, ...views.map(view => Buffer.byteLength(JSON.stringify(view)))), git_required: false }, null, 2));
