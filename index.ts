/** Export read-only, revision-bound evidence acquisition queues and their file adapter. */
export { reviewEvidenceRequests, reviewEvidenceRequestsFile } from './src/requests.ts';
/** Export the exact JSON/TOON wire serializer used for budget accounting and CLI output. */
export { serializeEvidenceRequests } from './src/output-budget.ts';
/** Export the strict packet, queue, one-artifact arrivals and typed remedies. */
export type { EvidenceSelection, EvidenceArrival, EvidenceRequestInput, EvidenceRequest, EvidenceRequestQueue, EvidenceRequestCode, EvidenceRequestRefusal, EvidenceRequestResult, EvidenceSelectionSkip, EvidenceArrivalRejection, EvidenceOutputFormat } from './src/requests-types.ts';

/** Export revision-scoped attention capture and read-only carry-forward. */
export { captureReviewScope, carryForwardReview } from './src/scope.ts';
/** Export portable scope receipts, reports and typed remedies. */
export type { ScopeObligation, ScopeSelection, ReviewScope, ScopeCode, ScopeRefusal, ScopeResult, CarryForwardReport, CarryForwardResult } from './src/scope-types.ts';

/** Export explicit backend-neutral artifact ingestion and its portable contracts. */
export { importEvidenceEnvelope } from './src/envelopes.ts';
/** Export bounded local-file and HTTP artifact imports. */
export { importReviewArtifact } from './src/envelope-artifact.ts';
/** Export typed source identity, receipts and remedies for review providers. */
export type { ReviewEvidenceEnvelope, EnvelopeInput, EnvelopeResult, EnvelopeReceipt, EnvelopeRefusal, EnvelopeCode } from './src/envelope-types.ts';

import { defineExtension } from '@unbrained/pm-cli/sdk/authoring';
import type { ExtensionApi } from '@unbrained/pm-cli/sdk/authoring';
import { registerReviewCommands } from './src/commands.ts';
import { REVIEW_FIELDS, REVIEW_TYPE } from './src/tracker.ts';

/** Export explicit cross-provider identity confirmation and compact receipts. */
export { findingLineage } from './src/lineage.ts';
/** Export lineage input, output and refusal contracts. */
export type { LineageOptions, LineageView, LineageResult, LineageCode, LineageIssue } from './src/lineage.ts';

/** Export typed SDK consumers without exposing a second GitHub network boundary. */
export { createGitHubTransport } from './src/github.ts';
/** Export core decisions for SDK hosts and real-tracker acceptance. */
export { findReviewItems, importFindings, precedents, ensureReviewSchema } from './src/tracker.ts';
/** Export complete-snapshot withdrawal controls and canonical import receipts. */
export type { ImportOptions, ImportReceipt } from './src/tracker.ts';
/** Export bot marker parsing and exact-head gate computation. */
export { findingsOf } from './src/findings.ts';
/** Export round computation with the same semantics as the registered command. */
export { evaluateRound, compactRound } from './src/round.ts';
/** Export durable decision application for typed clients. */
export { decide } from './src/verdict.ts';
/** Export source-aware verdict inputs, local receipts and deferred GitHub transports. */
export type { VerdictInput, VerdictReceipt, VerdictTransport } from './src/verdict.ts';
/** Export read-only source reconciliation for typed hosts. */
export { reconcile } from './src/reconcile.ts';
/** Export batch response and live status with the registered command semantics. */
export { respond, reviewStatus } from './src/respond.ts';
/** Export independent closeout verification for typed hosts. */
export { reviewCloseout } from './src/closeout.ts';
/** Export explicit review attention mapping independently of closeout and round gates. */
export { reviewCoverage, coverCriterion } from './src/coverage.ts';
/** Export typed criterion bindings, judgments and actionable refusals. */
export type { CoverOptions, CoverageBinding, CoverageCode, CoverageJudgment, CoverageMap, CoverageRefusal, CoverageResult } from './src/coverage-types.ts';
/** Export closeout verdict vocabulary. */
export type { CloseoutOptions, CloseoutReport, CloseoutFindingCode } from './src/closeout-types.ts';
/** Export contribution and receipt vocabulary for package consumers. */
export type { GitHubTransport, PullRequest, Verdict } from './src/types.ts';

/** Activate durable review context using the host's schema and command registries. */
export default defineExtension({
  name: 'pm-review', version: '2026.10.12', description: 'Bot review findings, verdict precedents and exact-head round completion',
  /** Register typed metadata before commands so host validation can use it. */
  activate(api: ExtensionApi): void {
    api.registerItemTypes([REVIEW_TYPE]);
    api.registerItemFields(REVIEW_FIELDS);
    registerReviewCommands(api);
  },
});
/** Export bounded raw-disposition witnesses; core decisions remain authoritative. */
export { reviewConflicts } from './src/conflicts.ts';
/** Export the shared compact JSON/TOON wire encoder. */
export { serializeConflictWitness } from './src/conflict-state.ts';
/** Export strict selection, scope, witness and actionable refusal contracts. */
export type { ConflictInput, ConflictCode, ConflictRefusal, ConflictScope, ConflictJudgment, ConflictPacket, ConflictResult } from './src/conflict-types.ts';
