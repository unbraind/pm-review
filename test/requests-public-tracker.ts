/** Measure the queue against a public tracker export without writing its native inputs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PmClient } from '@unbrained/pm-cli/sdk';
import { reviewEvidenceRequests, reviewEvidenceRequestsFile } from '../src/requests.ts';
import type { EvidenceRequestInput } from '../src/requests-types.ts';
import { queue } from './requests-fixture.ts';

const root = process.argv[2];
assert.ok(root, 'Supply a public tracker exported outside git');
const cwd = dirname(dirname(root));
const client = new PmClient({ cwd, pmRoot: root, noExtensions: true, author: 'public-validation' });
const paths = (await readdir(root, { recursive: true })).filter(path => !path.split('/').some(part => part.startsWith('.')));
const durable: string[] = [];
for (const path of paths) if ((await stat(join(root, path))).isFile()) durable.push(path);
/** Fingerprint the exact exported inputs, excluding only newly created derived caches. */
async function fingerprint(): Promise<string> {
  const hash = createHash('sha256');
  for (const path of durable.sort()) hash.update(path).update(await readFile(join(root, path)));
  return hash.digest('hex');
}
const before = await fingerprint();
const items = (await client.listAllComplete()).items;
const selected = items.filter(item => item.type === 'ReviewFinding' || item.acceptance_criteria?.trim()).slice(0, 64);
const packet: EvidenceRequestInput = { schema: 'review-requests/v1', select: selected.map(item => ({ item: item.id, obligation: item.type === 'ReviewFinding' ? 'finding' : 'AC1', missing: item.type === 'ReviewFinding' ? 'source' : 'test' })), arrivals: [], budget: { requests: 3, characters: 8192 } };
const result = queue(await reviewEvidenceRequests(client, packet));
const file = join(cwd, 'request-validation.json');
await writeFile(file, JSON.stringify(packet, null, 2).replaceAll('\n', '\r\n'));
assert.deepEqual(await reviewEvidenceRequestsFile(client, file), result);
const full = queue(await reviewEvidenceRequests(client, { ...packet, budget: { requests: 64, characters: 65536 } }));
assert.deepEqual([...result.requests.map(row => row.key), ...result.omitted.map(row => row.key)], full.requests.map(row => row.key));
assert.equal(await fingerprint(), before, 'A durable public tracker input changed');
const skipped: Record<string, number> = {};
for (const row of result.skipped) skipped[row.reason] = (skipped[row.reason] ?? 0) + 1;
console.log(JSON.stringify({ public_items: items.length, selected_obligations: selected.length, pending: result.pending, emitted: result.requests.length, exact_omissions: result.omitted.length, skipped, satisfied: result.satisfied.length, json_characters: result.characters, json_bytes: Buffer.byteLength(JSON.stringify(result)), crlf_file_replay_matches_sdk: true, durable_inputs_unchanged: durable.length, git_required: false, approval: result.approval }, null, 2));
