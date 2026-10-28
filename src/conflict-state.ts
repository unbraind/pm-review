import { encodeToon, isRuntimeRecord } from '@unbrained/pm-cli/sdk';
import type { ConflictCode, ConflictInput, ConflictRefusal, ConflictResult, ConflictScope } from './conflict-types.ts';

/** Apply one strict schema before SDK access; native revision strings are opaque and exact. */
export function conflictInput(value: unknown): ConflictInput | undefined {
  if (!isRuntimeRecord(value) || Object.keys(value).length !== 3 || !Object.hasOwn(value, 'schema') || !Object.hasOwn(value, 'item') || !Object.hasOwn(value, 'revision') || value.schema !== 'review-conflicts/v1' || !bounded(value.item, 512) || !value.item.trim() || !bounded(value.revision, 2048) || !value.revision.trim()) return undefined;
  return { schema: value.schema, item: value.item, revision: value.revision };
}

/** Bound strings without imposing new identifier or URL policies on historical native records. */
export function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }

/** Reuse exactly the scope fields persisted by the GitHub and envelope producers. */
export function conflictScope(item: Record<string, unknown>, revision: string): ConflictScope | undefined {
  if (item.review_head_source === 'envelope') return bounded(item.review_origin, 2048) && bounded(item.review_subject, 2048) ? { kind: 'envelope', target: JSON.stringify([item.review_origin, item.review_subject]), revision } : undefined;
  if (bounded(item.review_repo, 2048) && Number.isSafeInteger(item.review_pr) && Number(item.review_pr) > 0) return { kind: 'github', target: JSON.stringify([item.review_repo, item.review_pr]), revision };
  return undefined;
}

/** Keep source and text out of refusal diagnostics. */
export function conflictRefusal(code: ConflictCode): ConflictRefusal {
  const remedies: Record<ConflictCode, string> = {
    input_invalid: 'Supply exactly schema=review-conflicts/v1, one existing item id (1-512 characters), and its exact native review_head revision (1-2048 characters).',
    finding_unavailable: 'Select an existing ReviewFinding with readable, verified native history; inspect it with pm get and pm history.',
    scope_unavailable: 'Select an observation with native GitHub repo/PR or envelope origin/subject fields; do not infer scope from similar text.',
    lineage_too_large: 'Inspect the confirmed lineage with pm review lineage; this bounded witness supports at most 32 observations per lineage.',
    state_changed: 'A peer changed the lineage or an audited source revision during observation; read the current evidence and retry.',
    output_invalid: 'Inspect skipped source metadata with pm get; correct oversized source identities or invalid native values, then retry with a bounded lineage.',
  };
  return { ok: false, refusal: { code, remedy: remedies[code] } };
}

/** The command and SDK use the core encoders, including exact compact JSON output. */
export function serializeConflictWitness(result: ConflictResult, format: 'json' | 'toon' = 'json'): string {
  return format === 'json' ? JSON.stringify(result) : encodeToon(result);
}
