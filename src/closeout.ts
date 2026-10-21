import { resolve } from 'node:path';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { detectGaming, isTestFile, namedTests } from './closeout-detectors.ts';
import { artifactText, closeoutChanges } from './closeout-state.ts';
import { executeCloseout } from './closeout-run.ts';
import type { CloseoutExecution } from './closeout-run.ts';
import type { CloseoutChange, CloseoutCriterion, CloseoutOptions, CloseoutReport } from './closeout-types.ts';

/** Full item evidence accepts optional SDK collections without inventing missing evidence. */
type EvidenceItem = Pick<ItemMetadata, 'files' | 'docs' | 'acceptance_criteria' | 'comments' | 'tests'>;

/** Normalize optional SDK collections once before running the independent evaluation. */
export function itemEvidence(item: EvidenceItem): Required<EvidenceItem> {
  return { files: item.files ?? [], docs: item.docs ?? [], tests: item.tests ?? [], comments: item.comments ?? [], acceptance_criteria: item.acceptance_criteria ?? '' };
}

/** Bind a criterion only to an exact fresh test title or an explicit recorded comment mapping. */
export function criterionEvidence(text: string, index: number, item: EvidenceItem, report: CloseoutReport): CloseoutCriterion {
  const id = `AC${index + 1}`;
  const names = [...text.matchAll(/\[test:([^\]]+)\]/g)].map(/** Explicit titles avoid guessing from shared vocabulary. */ match => match[1].trim());
  if (names.length === 0) names.push(text.replace(/^[-*\d.)\s]+/, '').trim());
  const comments = (item.comments ?? []).flatMap(/** Comment ids are stable one-based positions in the append-only collection. */ (comment, position) => {
    const match = /^closeout (AC[1-9]\d*): test="([^"]+)"(?: file="([^"]+)")?$/.exec(comment.text.trim());
    return match && match[1] === id ? [{ name: match[2], file: match[3] ?? '', comment_id: `comment:${position + 1}` }] : [];
  });
  const bindings = [...(comments.length > 0 && !text.includes('[test:') ? [] : names).map(/** Direct criteria need no separate comment assertion. */ name => ({ name, file: '', comment_id: '' })), ...comments];
  const evidence = bindings.flatMap(/** A stored assertion is only a selector for independently executed evidence. */ binding => {
    const tests = report.tests.filter(/** Exact matching prevents unrelated successful tests from proving every criterion. */ test => test.name === binding.name);
    return tests.length === 0 ? [{ test: binding.name, result: 'missing', file: binding.file, comment_id: binding.comment_id }] : tests.map(/** Keep the command result alongside the named assertion. */ test => ({ test: test.name, result: test.result, file: binding.file || item.tests?.[test.command - 1]?.path || '', comment_id: binding.comment_id }));
  });
  const contradicted = evidence.some(/** A failed assertion contradicts the criterion even if another assertion passes. */ row => row.result === 'failed');
  const proven = evidence.length > 0 && evidence.every(/** Skipped titles and invalid file bindings do not prove outcomes. */ row => row.result === 'passed' && (!row.file || [...(item.files ?? []), ...(item.docs ?? []), ...(item.tests ?? [])].some(/** Only linked, present artifacts support a comment binding. */ link => link.path === row.file) && !report.findings.some(/** Missing artifacts invalidate linked evidence. */ finding => finding.file === row.file && finding.code === 'artifact_missing')));
  return { id, criterion: text, verdict: contradicted ? 'contradicted' : proven ? 'proven' : 'unproven', evidence };
}

/** Reduce fresh host results without exposing raw output or accepting bare successful exits. */
export function recordExecution(execution: CloseoutExecution, report: CloseoutReport): void {
  if (execution.error) report.findings.push({ code: 'execution_missing', file: '', detail: execution.error });
  execution.runs.forEach(/** Every command retains its result even when it supplies no named evidence. */ (run, index) => {
    const tests = namedTests(`${run.stdout ?? ''}\n${run.stderr ?? ''}`, index + 1);
    report.commands.push({ command: run.command ?? run.path ?? '', result: run.status });
    report.tests.push(...tests.map(/** A failed host assertion or context refusal invalidates apparently green output. */ test => ({ ...test, result: run.status !== 'passed' && test.result === 'passed' ? 'skipped' as const : test.result })));
    if (run.status !== 'passed') report.findings.push({ code: run.status === 'skipped' ? 'test_skipped' : 'test_failed', file: run.path ?? '', detail: `Linked command ${index + 1}: ${run.status}` });
    if (tests.length === 0) report.findings.push({ code: 'execution_missing', file: run.path ?? '', detail: `Linked command ${index + 1} has no named test assertions` });
    if (tests.some(/** TAP skip directives remain findings even when the runner exits zero. */ test => test.result === 'skipped')) report.findings.push({ code: 'test_skipped', file: run.path ?? '', detail: `Linked command ${index + 1} skipped named assertions` });
  });
}

/** Check invocation of changed functions using fresh native coverage rather than stale reports. */
export function checkInvocation(changes: CloseoutChange[], execution: CloseoutExecution, report: CloseoutReport): void {
  for (const change of changes) {
    if (isTestFile(change.file) || !/\.[cm]?[jt]s$/.test(change.file) || change.after === null || (change.after === change.before && !change.opaque)) continue;
    if (change.opaque) { report.findings.push({ code: 'execution_unverified', file: change.file, detail: 'Changed source is not comparable text' }); continue; }
    const before = change.before ?? '';
    const after = change.after;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = after.length;
    let previous = before.length;
    while (end > start && previous > start && after[end - 1] === before[previous - 1]) { end--; previous--; }
    const functions = (execution.functions ?? []).filter(/** Only functions overlapping changed source text are relevant. */ fn => fn.file === change.file && fn.start <= end && fn.end >= start);
    if (functions.length === 0) {
      report.findings.push({ code: 'execution_unverified', file: change.file, detail: 'No native function coverage overlaps changed source; use directly instrumented tests' });
    } else {
      const uncalled = functions.filter(/** Counts are unioned across test worker reports for the same function range. */ fn => !execution.functions!.some(/** Another worker may have exercised this same function. */ other => other.file === fn.file && other.start === fn.start && other.end === fn.end && other.count > 0));
      if (uncalled.length > 0) report.findings.push({ code: 'source_unexecuted', file: change.file, detail: 'A function overlapping changed source was never executed by linked tests' });
    }
  }
}

/** Distinguish a behavioral revert failure from a passing suite or an infrastructure refusal. */
export function recordRevert(reverted: CloseoutExecution, report: CloseoutReport): void {
  const failed = !reverted.error && reverted.runs.some(/** Infrastructure failures and build errors do not prove regression sensitivity. */ run => run.status === 'failed' && (run.failure_category === undefined || run.failure_category === 'assertion_failure') && namedTests(`${run.stdout ?? ''}\n${run.stderr ?? ''}`, 1).some(/** Require a baseline-passing named assertion to fail after source reversion. */ test => test.result === 'failed' && report.tests.some(/** The identical assertion must have passed before the revert. */ baseline => baseline.name === test.name && baseline.result === 'passed')));
  report.revert_check = failed ? 'sensitive' : reverted.error || reverted.runs.some(/** Refusals cannot demonstrate behavioral insensitivity. */ run => run.status !== 'passed') ? 'inconclusive' : 'survived';
  if (!failed) report.findings.push({ code: reverted.error || reverted.runs.some(/** Host refusals and failed builds are inconclusive rather than a successful revert proof. */ run => run.status !== 'passed') ? 'revert_inconclusive' : 'revert_survived', file: '', detail: 'Linked tests did not demonstrate a behavioral failure after source restore' });
}

/** Independently review completion evidence without writing to or closing the source item. */
export async function reviewCloseout(client: PmClient, id: string, options: CloseoutOptions): Promise<CloseoutReport> {
  const seconds = options.timeoutSeconds ?? 60;
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) throw new Error('--timeout must be between 1 and 600 seconds');
  const cwd = resolve(options.cwd);
  const item = itemEvidence((await client.get(id, { full: true })).item);
  const report: CloseoutReport = { id, ok: false, baseline: '', revert_check: 'not_requested', criteria: [], findings: [], skipped: [], tests: [], commands: [] };
  const state = closeoutChanges(cwd, item, options.base, report.skipped);
  report.baseline = state.baseline;
  report.findings.push(...detectGaming(state.changes));
  if (report.skipped.some(/** A missing artifact baseline prevents clearing gate-gaming checks. */ row => row.check.startsWith('baseline:') || row.check === 'diff')) report.findings.push({ code: 'baseline_missing', file: '', detail: 'Supply --base in git or closeout-before linked artifact notes' });
  for (const link of [...item.files, ...item.docs]) if (artifactText(cwd, link.path) === null) report.findings.push({ code: 'artifact_missing', file: link.path, detail: 'Linked artifact is absent' });
  if (item.tests.length === 0) report.findings.push({ code: 'execution_missing', file: '', detail: 'No linked tests; stored EXIT:0 claims are not execution evidence' });
  else {
    const execution = await executeCloseout(client, id, { ...options, cwd });
    recordExecution(execution, report);
    checkInvocation(state.changes, execution, report);
  }
  if (item.comments.some(/** Stored success claims need an independently observed run. */ comment => /EXIT\s*:\s*0/i.test(comment.text)) && report.tests.length === 0) report.findings.push({ code: 'exit_claim_without_run', file: '', detail: 'A stored EXIT:0 claim has no fresh named test execution' });
  const texts = item.acceptance_criteria.split(/[;\n]/).map(/** Ignore empty list separators, preserving criterion wording. */ text => text.trim()).filter(Boolean);
  report.criteria = texts.map(/** Every acceptance assertion gets its own conservative verdict. */ (text, index) => criterionEvidence(text, index, item, report));
  if (options.revertCheck) {
    report.revert_check = 'inconclusive';
    const source = state.changes.filter(/** Restore source only, retaining the changed tests and test policies. */ change => !isTestFile(change.file) && /\.[cm]?[jt]s$/.test(change.file) && (change.opaque || change.before !== change.after));
    if (source.some(/** Opaque baselines must never be written as source during restoration. */ change => change.opaque) || source.length === 0 || report.commands.length === 0 || report.commands.some(/** A failing baseline cannot establish behavioral sensitivity. */ run => run.result !== 'passed')) report.findings.push({ code: 'revert_inconclusive', file: '', detail: 'Revert check needs changed source and passing linked commands' });
    else {
      const reverted = await executeCloseout(client, id, { ...options, cwd }, source);
      recordRevert(reverted, report);
    }
  } else report.skipped.push({ check: 'revert-check', reason: 'Optional --revert-check was not requested' });
  report.ok = report.criteria.length > 0 && report.criteria.every(/** Exit zero requires every criterion to be proven with no open findings. */ criterion => criterion.verdict === 'proven') && report.findings.length === 0;
  return report;
}
