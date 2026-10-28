/** A single confirmed lineage and exact native artifact revision, never an inferred match. */
export interface ConflictInput { schema: 'review-conflicts/v1'; item: string; revision: string }
/** Expected refusals are recoverable without interpreting provider text. */
export type ConflictCode = 'input_invalid' | 'finding_unavailable' | 'scope_unavailable' | 'lineage_too_large' | 'state_changed' | 'output_invalid';
/** All failures contain a fixed remedy and omit backend exception details. */
export interface ConflictRefusal { ok: false; refusal: { code: ConflictCode; remedy: string } }
/** Scope compares native producer fields exactly; a confirmed identity can span different scopes. */
export interface ConflictScope { kind: 'github' | 'envelope'; target: string; revision: string }
/** One independently recorded current judgment with its original source identity. */
export interface ConflictJudgment {
  item: string; version: number; node: string; provider: string; reviewer: string; url: string;
  verdict: 'fix' | 'refuse'; reason: string; reason_omitted: number; commit: string;
  availability: 'observed' | 'withdrawn';
}
/** A bounded decision packet is evidence for a core decision, never a decision itself. */
export interface ConflictPacket {
  ok: true; schema: 'review-conflicts/v1'; item: string; scope: ConflictScope; revision: string;
  state: 'conflict' | 'no_opposition_observed' | 'insufficient_evidence';
  resolution: 'unverified'; consistency: 'observed';
  judgments: ConflictJudgment[];
  skipped: { item: string; reason: 'scope_mismatch' | 'not_explicit' | 'source_unavailable' }[];
  lineage_issues: number;
  missing: { kind: 'core_decision' | 'resolution_evidence' | 'review_availability'; remedy: string }[];
}
/** SDK and CLI return the same finite, bounded machine-readable result. */
export type ConflictResult = ConflictPacket | ConflictRefusal;
