import type { ItemDocument } from '@unbrained/pm-cli/sdk';

/** Populate every native metadata family, including nested collections and relationship attributes. */
export function richScopeDocument(document: ItemDocument, source: string): ItemDocument {
  const date = '2026-10-01T10:00:00.000Z';
  const log = { author: 'model-agent', created_at: date, text: '  Native annotation\r\nsecond line  ' };
  return { body: '  Artifact body\r\nretains bytes  ', metadata: {
    ...document.metadata, source_type: 'native-model', type_options: { mode: 'careful' },
    deadline: '2026-12-01T10:00:00.000Z', estimated_minutes: 10, design: 'native design', external_ref: 'example:reference',
    definition_of_ready: 'Ready for explicit review', order: 4,
    goal: 'goal', objective: 'objective', value: 'value', impact: 'impact', outcome: 'outcome', why_now: 'why now',
    parent: source, reviewer: 'reviewer', risk: 'medium', confidence: 77, sprint: 'next', release: 'next',
    blocked_by: source, blocked_reason: 'Blocked by evidence', unblock_note: 'Read evidence', reporter: 'reporter', severity: 'high',
    environment: 'synthetic', repro_steps: 'Read and compare', resolution: 'preserve', expected_result: 'exact fields', actual_result: 'exact fields',
    affected_version: '1', fixed_version: '2', component: 'review', regression: false, customer_impact: 'review attention',
    source_owner: 'model-owner', assignee: 'model-agent', close_reason: 'native optional field', duplicate_of: source,
    closed_at: date, completed_at: date, claim_principal: 'model-principal', test_runs: [{ run_id: 'seed-run', kind: 'test', status: 'passed', started_at: date, finished_at: date, recorded_at: date, passed: 1, failed: 0, skipped: 0, items: 1, linked_tests: 1, attempt: 1 }],
    dependencies: [{ id: source, kind: 'related', author: 'model-agent', created_at: date, source_kind: 'related_to' }],
    comments: [log], notes: [log], learnings: [log],
    files: [{ path: 'src/example.ts', scope: 'project', note: 'Native file' }],
    docs: [{ path: 'docs/example.md', scope: 'project', note: 'Native document' }],
    tests: [{ path: 'test/example.test.ts', scope: 'project', command: 'node --test test/example.test.ts', timeout_seconds: 10, pm_context_mode: 'tracker', workspace_context_mode: 'source', provenance: { author: 'model-agent', created_at: date, source_kind: 'local_mutation' }, updated_by: 'model-agent', updated_at: date, env_set: { MODE: 'safe' }, env_clear: ['TOKEN'], shared_host_safe: true, note: 'Native test note', assert_stdout_contains: ['pass'], assert_stdout_regex: ['pass'], assert_stderr_contains: [], assert_stderr_regex: [], assert_stdout_min_lines: 1, assert_json_field_equals: { ok: 'true' }, assert_json_field_gte: { count: 1 } }],
    reminders: [{ at: date, text: 'Native reminder' }],
    events: [{ start_at: date, end_at: '2026-10-01T11:00:00.000Z', title: 'Native event', description: 'Description', location: 'synthetic', all_day: false, timezone: 'UTC', recurrence: { freq: 'weekly', interval: 1, count: 2, by_weekday: ['mon'], exdates: [] } }],
    plan_mode: 'review', plan_scope: 'Native scope', plan_harness: 'codex', plan_resume_context: 'Resume safely',
    plan_steps: [{ id: 'step-one', order: 1, title: 'Native step', body: 'Native step body', status: 'pending', owner: 'model-agent', evidence: 'review', blocked_reason: 'none', linked_items: [{ id: source, kind: 'related' }], files: [{ path: 'src/example.ts' }], tests: [{ command: 'node --test' }], docs: [{ path: 'docs/example.md' }], created_at: date, updated_at: date }],
    plan_decisions: [{ ts: date, author: 'model-agent', decision: 'Preserve native fields', rationale: 'Exact comparison', evidence: 'SDK', step_id: 'step-one' }],
    plan_discoveries: [{ ts: date, author: 'model-agent', text: 'Native discovery', step_id: 'step-one' }],
    plan_validation: [{ text: 'Native validation', command: 'node --test', expected: 'pass' }],
  } };
}
