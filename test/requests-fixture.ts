import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { ensureReviewSchema, fieldOptions, importFindings } from '../src/tracker.ts';
import type { EvidenceRequestInput, EvidenceRequestQueue, EvidenceRequestResult } from '../src/requests-types.ts';
import { tracker, pullRequest } from './helpers.ts';
import { coverCriterion, reviewCoverage } from '../src/coverage.ts';
import { findingsOf } from '../src/findings.ts';
import type { PmClient } from '@unbrained/pm-cli/sdk';
import type { CoverageMap } from '../src/coverage-types.ts';

/** Seed one finding, a criterion gap and separate native source/test artifacts in a plain tracker. */
export async function requestsFixture(t: TestContext) {
  const base = await tracker(t);
  await ensureReviewSchema(base.client);
  const finding = (await base.client.create({ type: 'ReviewFinding', title: 'Guard the input before mutation', description: 'The unsafe value crosses the validation boundary.', ...fieldOptions({ review_summary: 'Guard the input before mutation', review_path: 'src/input.ts', review_line: 12 }) })).item.id;
  const gap = (await base.client.create({ type: 'Task', title: 'Validate the input boundary', acceptanceCriteria: 'Reject invalid input; Preserve valid values' })).item.id;
  const evidence = (await base.client.create({ type: 'Task', title: 'Focused evidence artifact', description: 'export function validate(input: unknown) { return typeof input === "string"; }', file: ['path=src/input.ts,note=Only the validation function'], test: ['command=node --test test/input.test.ts,note=Named invalid-input assertion'] })).item.id;
  const packet: EvidenceRequestInput = { schema: 'review-requests/v1', select: [{ item: finding, obligation: 'finding', missing: 'source' }, { item: gap, obligation: 'AC1', missing: 'test' }], arrivals: [], budget: { requests: 64, characters: 65536 } };
  return { ...base, finding, gap, evidence, packet };
}

/** Narrow success with useful diagnostics. */
export function queue(result: EvidenceRequestResult): EvidenceRequestQueue { assert.equal(result.ok, true, JSON.stringify(result)); return result as EvidenceRequestQueue; }

/** Refusal vocabulary stays actionable across SDK and command renderers. */
export function requestsDenied(result: EvidenceRequestResult, code: string): void {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Expected refusal');
  assert.equal(result.refusal.code, code);
  assert.ok(result.refusal.remedy.length > 20);
}

/** Establish real criterion attention for both acquisition and source-drift regressions. */
export async function reviewedRequestGap(client: PmClient, id: string) {
  const map = await reviewCoverage(client, id) as CoverageMap;
  const snapshot = pullRequest({ reviews: [], comments: [] });
  const observations = findingsOf(snapshot);
  const receipt = await importFindings(client, snapshot, observations);
  const source = receipt.items[0].id;
  const binding = { revision: map.revision, criterion: 'AC1', evidence: source, judgment: 'reviewed' as const, excerpt: 'Validate the input before writing.', reason: 'Reviews the invalid input boundary' };
  await coverCriterion(client, id, binding);
  return { source, binding };
}
