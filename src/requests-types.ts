import type { CoverageCode } from './coverage-types.ts';

/** One explicitly selected current review obligation and the smallest artifact needed. */
export interface EvidenceSelection { item: string; obligation: string; missing: 'source' | 'test' }
/** Explicit arrival points at one native link and the evidence item's audited revision. */
export interface EvidenceArrival { request: string; item: string; version: number; field: 'files' | 'tests'; index: number }
/** Shared strict SDK/CLI packet; no tracker state is imported or mutated. */
export interface EvidenceRequestInput {
  schema: 'review-requests/v1'; select: EvidenceSelection[]; arrivals: EvidenceArrival[];
  budget: { requests: number; characters: number };
}
/** One bounded acquisition request, independent of approval or test execution. */
export interface EvidenceRequest extends EvidenceSelection {
  key: string; version: number; text: string; text_omitted: number; path: string; line: number; ask: string;
}
/** Stable refusals cover malformed packets, unavailable files and inconsistent observations. */
export type EvidenceRequestCode = 'input_invalid' | 'file_unavailable' | 'state_changed' | 'budget_too_small' | 'output_invalid';
/** Foreign, retired or unavailable selections remain accounted for without fabricating requests. */
export type EvidenceSelectionSkip = CoverageCode | 'item_unavailable' | 'coverage_unavailable' | 'status_unknown' | 'obligation_terminal' | 'not_review_finding' | 'finding_resolved' | 'criterion_reviewed' | 'source_path_too_large';
/** Arrival refusal never silently deletes its associated pending request. */
export type EvidenceArrivalRejection = 'evidence_unavailable' | 'evidence_changed' | 'evidence_type_mismatch' | 'artifact_missing' | 'source_path_mismatch' | 'request_not_current';
/** Expected failures carry a concrete recovery step. */
export interface EvidenceRequestRefusal { ok: false; refusal: { code: EvidenceRequestCode; remedy: string } }
/** Every selection is accounted for; omission keys name the exact unreturned requests. */
export interface EvidenceRequestQueue {
  ok: true; schema: 'review-requests/v1'; approval: 'unverified'; consistency: 'observed';
  total: number; pending: number; characters: number; requests: EvidenceRequest[];
  omitted: { key: string; reason: 'request_limit' | 'character_limit' }[];
  satisfied: { key: string; item: string; version: number }[];
  skipped: { selection: number; reason: EvidenceSelectionSkip }[];
  rejected: { arrival: number; reason: EvidenceArrivalRejection }[];
}
/** Queue and command share exactly the same result contract. */
export type EvidenceRequestResult = EvidenceRequestQueue | EvidenceRequestRefusal;
