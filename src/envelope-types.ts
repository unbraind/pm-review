/** Portable review observations; revisions may identify code commits or document versions. */
export interface ReviewEvidenceEnvelope {
  version: 1;
  source: { provider: string; origin: string; artifact: string; revision: string; subject: string; url: string; reviewer: string };
  provenance: { kind: 'declared' };
  findings: { id: string; summary: string; body: string; path?: string; line?: number }[];
}
/** Expected artifact failures are stable data with actionable remedies. */
export type EnvelopeCode = 'envelope_invalid' | 'provenance_unsupported' | 'identity_conflict' | 'artifact_unavailable' | 'artifact_too_large' | 'digest_mismatch' | 'input_invalid';
/** A refusal never treats provider assertions as authenticated review completion. */
export interface EnvelopeRefusal { ok: false; refusal: { code: EnvelopeCode; remedy: string } }
/** Bounded receipts omit review bodies and source locations supplied to the loader. */
export interface EnvelopeReceipt {
  ok: true; provider: string; revision: string; created: number; reused: number;
  completion: 'unverified'; items: { id: string; finding: string }[];
}
/** Shared SDK and command result contract. */
export type EnvelopeResult = EnvelopeReceipt | EnvelopeRefusal;
/** Exactly one explicit artifact and its independently obtained byte digest are required. */
export interface EnvelopeInput { file?: string; url?: string; sha256: string }
