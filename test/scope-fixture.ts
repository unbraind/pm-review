import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { ScopeResult, CarryForwardResult, ScopeCode } from '../src/scope-types.ts';
import { tracker } from './helpers.ts';

/** Real plain tracker and independently versioned evidence for scope tests. */
export async function scopeFixture(t: TestContext) {
  const base = await tracker(t);
  const source = (await base.client.create({ id: 'evidence', type: 'Task', title: 'Substantive reviewer evidence', description: 'Input validation was reviewed at each boundary.' })).item;
  const artifact = (await base.client.create({ id: 'artifact', type: 'Task', title: 'Versioned artifact', description: 'Validate input bytes', acceptanceCriteria: 'Reject invalid values; Preserve valid values; Track missing review', dep: [`id=${source.id},kind=related`] })).item;
  const selection = { version: 1, author: 'scope-reviewer', reason: 'Explicit input validation review scope', obligations: [
    { criterion: 'AC1', fields: ['description'], evidence: [{ id: source.id, version: 1 }], judgment: 'reviewed' },
    { criterion: 'AC2', fields: ['dependencies'], evidence: [], judgment: 'reviewed' },
    { criterion: 'AC3', fields: ['title'], evidence: [], judgment: 'gap' },
  ] };
  return { ...base, id: artifact.id, evidence: source.id, selection };
}

/** Assert structured refusal codes and actionable remedies for either SDK operation. */
export function scopeDenied(result: ScopeResult | CarryForwardResult, code: ScopeCode): void {
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Expected a typed refusal');
  assert.equal(result.refusal.code, code);
  assert.ok(result.refusal.remedy.length > 20);
}
