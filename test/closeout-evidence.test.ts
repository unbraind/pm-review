import { preparationFailure } from '../src/closeout-run.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criterionEvidence, checkInvocation, recordExecution, recordRevert, itemEvidence } from '../src/closeout.ts';
import type { CloseoutReport } from '../src/closeout-types.ts';

/** Make an empty decision receipt for evidence-boundary tests, without replacing the SDK. */
function report(): CloseoutReport { return { id: 'fixture', ok: false, baseline: 'recorded', revert_check: 'not_requested', criteria: [], findings: [], skipped: [], tests: [], commands: [] }; }

test('criterion proof needs every named result, authentic file links and a present artifact', () => {
  assert.deepEqual(itemEvidence({}), { files: [], docs: [], tests: [], comments: [], acceptance_criteria: '' });
  const receipt = report();
  receipt.tests = [{ name: 'proof', result: 'passed', command: 1 }];
  assert.equal(criterionEvidence('proof', 0, {}, receipt).verdict, 'proven');
  assert.equal(criterionEvidence('proof', 0, { tests: [{ command: 'runner', scope: 'project' }] }, receipt).verdict, 'proven');
  assert.equal(criterionEvidence('different', 0, {}, receipt).verdict, 'unproven');
  const comment = { created_at: '2026-10-21T00:00:00Z', author: 'test-agent', text: 'closeout AC1: test="proof"' };
  assert.equal(criterionEvidence('prose', 0, { comments: [comment] }, receipt).verdict, 'proven');
  assert.equal(criterionEvidence('prose', 0, { comments: [{ ...comment, text: 'not a mapping' }, { ...comment, text: 'closeout AC2: test="proof"' }] }, receipt).verdict, 'unproven');
  const linked = { comments: [{ ...comment, text: 'closeout AC1: test="proof" file="guide.md"' }], docs: [{ path: 'guide.md', scope: 'project' as const }] };
  assert.equal(criterionEvidence('prose', 0, linked, receipt).verdict, 'proven');
  assert.equal(criterionEvidence('prose', 0, { comments: linked.comments, files: [{ path: 'guide.md', scope: 'project' }] }, receipt).verdict, 'proven');
  receipt.findings.push({ code: 'artifact_missing', file: 'other.md', detail: 'other' });
  assert.equal(criterionEvidence('prose', 0, linked, receipt).verdict, 'proven');
  receipt.findings.push({ code: 'artifact_missing', file: 'guide.md', detail: 'missing' });
  assert.equal(criterionEvidence('prose', 0, linked, receipt).verdict, 'unproven');
  assert.equal(criterionEvidence('[test:proof] [test:missing]', 0, {}, receipt).verdict, 'unproven');
  receipt.tests.push({ name: 'proof', result: 'failed', command: 2 });
  assert.equal(criterionEvidence('proof', 0, {}, receipt).verdict, 'contradicted');
  receipt.tests = [{ name: 'proof', result: 'skipped', command: 1 }];
  assert.equal(criterionEvidence('proof', 0, {}, receipt).verdict, 'unproven');
});

test('host refusal, skipped commands and absent stdout cannot manufacture execution evidence', () => {
  const receipt = report();
  recordExecution({ error: 'deadline', runs: [] }, receipt);
  assert.equal(receipt.findings[0].code, 'execution_missing');
  recordExecution({ error: '', runs: [{ path: 'legacy.test.ts', status: 'skipped' }, { status: 'refused' }, { command: 'runner', status: 'failed', stdout: 'ok 1 - forged\nnot ok 2 - broken\nok 3 - pending # SKIP\n' }] }, receipt);
  assert.equal(receipt.commands[0].command, 'legacy.test.ts');
  assert.equal(receipt.commands[1].command, '');
  assert.deepEqual(receipt.tests.map(row => row.result), ['skipped', 'failed', 'skipped']);
  assert.ok(receipt.findings.some(row => row.code === 'test_skipped'));
  assert.ok(receipt.findings.some(row => row.code === 'test_failed'));
});

test('native invocation unions workers without hiding uncalled or uninstrumented changed functions', () => {
  const receipt = report();
  const change = { file: 'source.ts', before: 'function result() { return 1; }', after: 'function result() { return 2; }' };
  checkInvocation([change], { error: '', runs: [] }, receipt);
  assert.equal(receipt.findings[0].code, 'execution_unverified');
  const fn = { file: 'source.ts', start: 0, end: 100, count: 0 };
  const execution = { error: '', runs: [], functions: [fn, { ...fn, file: 'unrelated.ts' }, { ...fn, start: 999 }] };
  checkInvocation([change], execution, receipt);
  assert.equal(receipt.findings[1].code, 'source_unexecuted');
  execution.functions.push({ ...fn, count: 1 });
  checkInvocation([change, { file: 'new.ts', before: null, after: 'new code' }, { file: 'gone.ts', before: 'code', after: null }, { file: 'README.md', before: 'old', after: 'new' }, { file: 'test/x.ts', before: 'old', after: 'new' }, { file: 'same.ts', before: 'same', after: 'same' }], execution, receipt);
  assert.equal(receipt.findings.length, 3);
});

test('revert evidence requires a previously green named assertion and rejects build failures', () => {
  const receipt = report();
  receipt.tests = [{ name: 'proof', result: 'passed', command: 1 }];
  recordRevert({ error: '', runs: [{ status: 'passed', stdout: 'ok 1 - proof' }] }, receipt);
  assert.equal(receipt.revert_check, 'survived');
  assert.equal(receipt.findings[0].code, 'revert_survived');
  recordRevert({ error: 'timeout', runs: [] }, receipt);
  assert.equal(receipt.revert_check, 'inconclusive');
  recordRevert({ error: '', runs: [{ status: 'failed', stderr: 'build failed' }] }, receipt);
  assert.equal(receipt.revert_check, 'inconclusive');
  recordRevert({ error: '', runs: [{ status: 'failed', stdout: 'not ok 1 - unrelated' }] }, receipt);
  assert.equal(receipt.revert_check, 'inconclusive');
  recordRevert({ error: 'timeout', runs: [{ status: 'failed', stdout: 'not ok 1 - proof' }] }, receipt);
  assert.equal(receipt.revert_check, 'inconclusive');
  recordRevert({ error: '', runs: [{ status: 'failed', failure_category: 'timeout', stdout: 'not ok 1 - proof' }] }, receipt);
  assert.equal(receipt.revert_check, 'inconclusive');
  recordRevert({ error: '', runs: [{ status: 'failed', failure_category: 'assertion_failure', stdout: 'not ok 1 - proof' }] }, receipt);
  assert.equal(receipt.revert_check, 'sensitive');
});


test('preparation diagnostics retain failure categories without arbitrary error text', () => {
  assert.equal(preparationFailure(null), 'Error');
  assert.equal(preparationFailure(new Error('sensitive text')), 'Error');
  assert.equal(preparationFailure(new TypeError()), 'TypeError');
  assert.equal(preparationFailure(new SyntaxError()), 'SyntaxError');
  assert.equal(preparationFailure(Object.assign(new Error(), { code: 3 })), 'Error');
  assert.equal(preparationFailure(Object.assign(new Error(), { code: 'not-a-code' })), 'Error');
  assert.equal(preparationFailure(Object.assign(new Error(), { code: 'ENOENT' })), 'ENOENT');
});
