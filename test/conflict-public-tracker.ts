/** Measure public native inputs in an exported non-git tracker; never contact providers or write sources. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { reviewConflicts, serializeConflictWitness } from '../index.ts';
import { lineageGroups } from '../src/lineage.ts';

const root = process.argv[2];
assert.ok(root, 'Supply a public native tracker export outside git');
const client = new PmClient({ cwd: dirname(dirname(root)), pmRoot: root, author: 'public-validation', noExtensions: true });
const exported = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name)).filter(path => !relative(root, path).split('/').some(part => part.startsWith('.'))).sort();
const durable: string[] = [];
// Exported inputs are chmod 0444; writable derived SDK caches from a previous run are not source artifacts.
for (const path of exported) if (((await stat(path)).mode & 0o222) === 0) durable.push(path);
assert.ok(durable.length > 0, 'Supply an export with native input files made read-only');
/** Fingerprint every exported durable input, excluding derived caches created after this inventory. */
async function fingerprint(): Promise<string> {
  const chunks = await Promise.all(durable.map(async path => Buffer.concat([Buffer.from(relative(root, path) + '\0'), await readFile(path)])));
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}
const before = await fingerprint();
const items = (await client.listAllComplete()).items;
const reviews = items.filter(item => item.type === 'ReviewFinding');
const groups = lineageGroups(reviews);
const selected = new Set<string>();
const states: Record<string, number> = {};
const refusals: Record<string, number> = {};
let packets = 0; let judgments = 0; let skipped = 0; let jsonBytes = 0; let toonBytes = 0; let replays = 0;
for (const row of reviews) {
  const key = JSON.stringify([groups.get(row.id), row.review_head, row.review_repo, row.review_pr, row.review_origin, row.review_subject]);
  if (selected.has(key)) continue;
  selected.add(key);
  const input = { schema: 'review-conflicts/v1', item: row.id, revision: row.review_head };
  const result = await reviewConflicts(client, input);
  if (!result.ok) { refusals[result.refusal.code] = (refusals[result.refusal.code] ?? 0) + 1; continue; }
  packets++; judgments += result.judgments.length; skipped += result.skipped.length;
  states[result.state] = (states[result.state] ?? 0) + 1;
  jsonBytes = Math.max(jsonBytes, Buffer.byteLength(serializeConflictWitness(result)));
  toonBytes = Math.max(toonBytes, Buffer.byteLength(serializeConflictWitness(result, 'toon')));
  const replay = JSON.parse(JSON.stringify(input, null, 2).replaceAll('\n', '\r\n')) as unknown;
  assert.deepEqual(await reviewConflicts(client, replay), result);
  replays++;
}
assert.equal(await fingerprint(), before, 'A durable public input changed');
console.log(JSON.stringify({ items: items.length, review_findings: reviews.length, lineage_scopes: selected.size, packets, judgments, skipped, states, refusals, maximum_json_bytes: jsonBytes, maximum_toon_bytes: toonBytes, crlf_query_replays: replays, durable_inputs_unchanged: durable.length, resolution: 'unverified', git_required: false }, null, 2));
