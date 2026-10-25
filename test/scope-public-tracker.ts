/** Read-only measurement against an explicitly exported public tracker outside Git. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PmClient, getHistoryPath, readHistoryEntries } from '@unbrained/pm-cli/sdk';
import { captureReviewScope, carryForwardReview } from '../src/scope.ts';
import type { CarryForwardReport } from '../src/scope-types.ts';

const pmRoot = process.argv[2];
assert.ok(pmRoot, 'Supply the read-only exported public tracker root');
/** Hash source names and bytes; include hidden inputs but omit disposable SDK cache directories. */
async function sourceFiles(directory: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.cache', '.runtime', '.locks', '.transactions'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) for (const [key, value] of await sourceFiles(path)) result.set(key, value);
    else result.set(relative(pmRoot, path), createHash('sha256').update(await readFile(path)).digest('hex'));
  }
  return result;
}
const before = await sourceFiles(pmRoot);
const client = new PmClient({ cwd: dirname(dirname(pmRoot)), pmRoot, noExtensions: true, author: 'public-validation' });
const all = (await client.listAllComplete()).items;
const counts = { unchanged: 0, stale: 0, never_reviewed: 0, removed: 0 };
let artifacts = 0;
let changed = 0;
let refusals = 0;
const refusalCodes: Record<string, number> = {};
let maxBytes = 0;
let replays = 0;
let examinedVersions = 0;
for (const item of all) {
  const history = await readHistoryEntries(getHistoryPath(pmRoot, item.id), item.id);
  if (history.length === 0) continue;
  examinedVersions += history.length;
  // These declarations exercise public native data; they assert no real reviewer approval.
  const selection = { version: 1, author: 'public-validation', reason: 'Algorithm validation on a public native artifact; attention is a test declaration', obligations: [{ criterion: 'AC1', fields: ['description'], evidence: [], judgment: 'reviewed' }] };
  const scope = await captureReviewScope(client, item.id, selection);
  if (!scope.ok) { refusals++; refusalCodes[scope.refusal.code] = (refusalCodes[scope.refusal.code] ?? 0) + 1; continue; }
  const report = await carryForwardReview(client, item.id, scope) as CarryForwardReport;
  assert.equal(report.ok, true);
  assert.equal(report.approval, 'unverified');
  const replay = await carryForwardReview(client, item.id, JSON.parse(JSON.stringify(scope, null, 2).replaceAll('\n', '\r\n')));
  assert.deepEqual(replay, report);
  replays++;
  artifacts++;
  changed += Number(report.artifact_changed);
  for (const state of Object.keys(counts) as (keyof typeof counts)[]) counts[state] += report.counts[state];
  maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(report)));
}
assert.deepEqual(await sourceFiles(pmRoot), before, 'Exported public inputs changed during comparison');
console.log(JSON.stringify({ public_items: all.length, history_versions_examined: examinedVersions, artifacts_compared: artifacts, changed_artifacts: changed, no_criterion_or_history_refusals: refusals, refusal_codes: refusalCodes, obligations: counts, receipt_replays: replays, durable_source_files_unchanged: before.size, largest_report_json_bytes: maxBytes, exact_artifact_approvals: 0, git_required: false }, null, 2));
