/** Validate real public review observations read-only, importing only into a separate plain tracker. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { importReviewArtifact } from '../src/envelope-artifact.ts';
import type { EnvelopeReceipt, ReviewEvidenceEnvelope } from '../src/envelope-types.ts';

const [sourceRoot, destination] = process.argv.slice(2);
assert.ok(sourceRoot && destination, 'Supply an exported public tracker and a separate scratch directory');
/** Fingerprint every durable exported file by relative name and bytes. */
async function fingerprint(directory: string): Promise<{ digest: string; count: number }> {
  const hash = createHash('sha256');
  let count = 0;
  /** Walk only the explicit tracker copy, skipping disposable SDK read caches. */
  async function walk(relative: string): Promise<void> {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || ['runtime', 'locks', 'search', 'transactions'].includes(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { hash.update(path).update(await readFile(join(directory, path))); count++; }
    }
  }
  await walk('');
  return { digest: hash.digest('hex'), count };
}
const before = await fingerprint(sourceRoot);
const source = new PmClient({ cwd: dirname(dirname(sourceRoot)), pmRoot: sourceRoot, noExtensions: true, author: 'public-validation' });
const items = (await source.listAllComplete()).items;
const findings = items.filter(item => item.type === 'ReviewFinding');
const eligible = findings.filter(item => typeof item.review_head === 'string' && item.review_head.length > 0);
const client = new PmClient({ cwd: destination, pmRoot: join(destination, '.agents/pm'), noExtensions: true, author: 'public-validation' });
await client.init('validation', { defaults: true, mergeFence: false, agentGuidance: 'skip' });
let bytes = '';
const server = createServer((_req, res) => { res.end(bytes); });
await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/review`;
let created = 0;
let reused = 0;
let largest = 0;
const revisions = new Set<string>();
try {
  for (const item of eligible) {
    const envelope: ReviewEvidenceEnvelope = {
      version: 1,
      source: { provider: 'github-tracker-export', origin: 'https://github.com', artifact: String(item.review_node_id), revision: String(item.review_head), subject: `https://github.com/${String(item.review_repo)}/pull/${String(item.review_pr)}`, url: String(item.review_url), reviewer: String(item.review_bot) },
      provenance: { kind: 'declared' },
      findings: [{ id: String(item.review_node_id), summary: String(item.review_summary), body: item.description }],
    };
    bytes = JSON.stringify(envelope);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = join(destination, 'review.json');
    await writeFile(file, bytes);
    const local = await importReviewArtifact(client, { file, sha256 });
    assert.equal(local.ok, true, JSON.stringify(local));
    const remote = await importReviewArtifact(client, { url, sha256 });
    assert.equal(remote.ok, true, JSON.stringify(remote));
    const receipt = local as EnvelopeReceipt;
    created += receipt.created;
    reused += (remote as EnvelopeReceipt).reused;
    largest = Math.max(largest, Buffer.byteLength(JSON.stringify(receipt)), Buffer.byteLength(JSON.stringify(remote)));
    revisions.add(receipt.revision);
    const stored = (await client.get(receipt.items[0].id, { full: true })).item;
    assert.equal(stored.review_head, item.review_head);
    assert.equal(stored.description, item.description);
    assert.equal(receipt.completion, 'unverified');
  }
} finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
assert.deepEqual(await fingerprint(sourceRoot), before, 'Read-only public source files changed');
assert.equal((await client.listAllComplete()).items.length, created);
console.log(JSON.stringify({ public_items: items.length, review_findings: findings.length, known_revision_findings: eligible.length, missing_revision_held: findings.length - eligible.length, local_created: created, http_reused: reused, revisions_preserved: revisions.size, durable_source_files_unchanged: before.count, largest_receipt_json_bytes: largest, completion_claims: 0, git_required: false }, null, 2));
