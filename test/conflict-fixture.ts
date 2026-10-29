import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PmClient } from '@unbrained/pm-cli/sdk';
import { findingLineage } from '../src/lineage.ts';
import type { LineageView } from '../src/lineage.ts';
import { fieldOptions, recordVerdict } from '../src/tracker.ts';
import { lineageFixture } from './helpers.ts';
import type { ConflictInput, ConflictPacket, ConflictResult } from '../src/conflict-types.ts';

/** Start with two confirmed observations before assigning independent opposing judgments. */
export async function conflictFixture(t: TestContext) {
  const base = await lineageFixture(t);
  await base.client.update(base.ids[1], fieldOptions({ review_head: base.pr.head }));
  const proposal = await findingLineage(base.client, base.ids[0], { with: base.ids[1] }) as LineageView;
  const linked = await findingLineage(base.client, base.ids[0], { with: base.ids[1], confirm: true, revision: proposal.revision, reason: 'The same validation boundary is explicitly confirmed across providers' });
  assert.equal(linked.ok, true);
  for (const [index, id] of base.ids.entries()) await recordVerdict(base.client, (await base.client.listAllComplete()).items.find(row => row.id === id)!, index === 0 ? 'fix' : 'refuse', index === 0 ? 'Fix the missing validation before accepting input' : 'Existing validation already covers this exact boundary', '');
  const input: ConflictInput = { schema: 'review-conflicts/v1', item: base.ids[0], revision: base.pr.head };
  return { ...base, input };
}

/** Narrow a successful packet while retaining useful refusal diagnostics. */
export function conflictPacket(result: ConflictResult): ConflictPacket {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as ConflictPacket;
}

/** Model records accepted by the previously released lineage reader, without bypassing native history. */
export async function addConflictSource(client: PmClient, root: string, index: number, large = false): Promise<string> {
  const item = (await client.create({ type: 'ReviewFinding', title: `Additional explicit source ${index}`, parent: 'none', ...fieldOptions({ review_bot: 'same-provider', review_node_id: `source-${index}${large ? 'n'.repeat(1900) : ''}`, review_url: 'https://reviews.example.org/' + (large ? 'u'.repeat(4000) : String(index)), review_head: 'a'.repeat(40), review_repo: 'example/package', review_pr: 1, review_verdict: 'fix', review_verdict_source: 'local', review_reason: 'Explicit additional input validation reasoning', review_commit: large ? 'c'.repeat(2000) : '' }) })).item;
  await client.comments(root, { add: 'review-lineage/v1 ' + JSON.stringify({ with: item.id, revision: 'a'.repeat(64), reason: 'Previously persisted explicit identity confirmation' }) });
  return item.id;
}
