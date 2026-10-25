/** Explicit native item-field scope for one criterion; evidence is bound in full. */
export interface ScopeObligation {
  criterion: string; fields: string[]; evidence: { id: string; version: number }[];
  judgment: 'reviewed' | 'gap';
}
/** Capture only a verified durable history version explicitly declared reviewed by the caller. */
export interface ScopeSelection {
  version: number; author: string; reason: string; obligations: ScopeObligation[];
}
/** Portable digest receipt; contains no source bodies or inferred approvals. */
export interface ReviewScope {
  ok: true; schema: 'review-scope/v1'; id: string; version: number; author: string; reason: string;
  artifact: string;
  obligations: {
    criterion: string; digest: string; judgment: 'reviewed' | 'gap';
    fields: { name: string; digest: string }[];
    evidence: { id: string; version: number; digest: string }[];
  }[];
}
/** Data refusals let agents recover without parsing exceptions or backend diagnostics. */
export type ScopeCode = 'scope_invalid' | 'scope_unavailable' | 'history_unavailable' | 'criterion_unknown' | 'field_unknown' | 'baseline_changed' | 'state_changed';
/** Stable failure vocabulary with a concrete next step. */
export interface ScopeRefusal { ok: false; refusal: { code: ScopeCode; remedy: string } }
/** Retention is attention only, even when every obligation is unchanged. */
export interface CarryForwardReport {
  ok: true; id: string; from: number; artifact: string; artifact_changed: boolean;
  approval: 'unverified'; consistency: 'observed';
  counts: Record<'unchanged' | 'stale' | 'never_reviewed' | 'removed', number>;
  obligations: { criterion: string; state: 'unchanged' | 'stale' | 'never_reviewed' | 'removed'; reasons: string[] }[];
}
/** Both operations return typed refusals without writing tracker state. */
export type ScopeResult = ReviewScope | ScopeRefusal;
/** Comparison never upgrades a retained judgment into exact-artifact approval. */
export type CarryForwardResult = CarryForwardReport | ScopeRefusal;
