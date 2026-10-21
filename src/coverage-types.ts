/** Refusals are data so agents can select a remedy without parsing prose. */
export type CoverageCode = 'criteria_missing' | 'criterion_unknown' | 'criteria_changed' | 'evidence_missing' | 'evidence_ineligible' | 'evidence_changed' | 'judgment_invalid' | 'mapping_invalid';
/** An actionable refusal applies to a request or an individual stored mapping. */
export interface CoverageRefusal { code: CoverageCode; remedy: string }
/** Explicit human or agent assessment; reviewed does not mean passed or proven. */
export interface CoverageBinding {
  revision: string; criterion: string; evidence: string; digest: string;
  excerpt: string; reason: string; judgment: 'reviewed' | 'gap';
}
/** Inputs deliberately omit digest: the package captures the current source itself. */
export type CoverOptions = Omit<CoverageBinding, 'digest'>;
/** Compact attributable judgment; full excerpts and source bodies stay in the tracker. */
export interface CoverageJudgment {
  comment: number; author: string; date: string; criterion: string;
  evidence: string; reviewer: string; url: string; head: string;
  judgment: 'reviewed' | 'gap'; reason: string; refusal?: CoverageRefusal;
}
/** Map is an inventory of review attention, independent of completion and assurance gates. */
export interface CoverageMap {
  ok: true; id: string; revision: string; total: number; reviewed: number; unreviewed: number;
  criteria: { id: string; text: string; state: 'reviewed' | 'unreviewed' | 'gap' }[];
  judgments: CoverageJudgment[];
}
/** Typed result for a missing contract or refused write. Missing items remain SDK errors. */
export type CoverageResult = CoverageMap | { ok: false; id: string; refusal: CoverageRefusal };
