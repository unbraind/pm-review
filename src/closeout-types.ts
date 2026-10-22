/** Independent closeout findings remain open until the underlying evidence changes. */
export type CloseoutFindingCode = 'baseline_missing' | 'threshold_lowered' | 'gate_changed' | 'test_skipped' | 'test_focused' | 'test_deleted' | 'execution_missing' | 'test_failed' | 'revert_survived' | 'revert_inconclusive' | 'artifact_missing' | 'source_unexecuted' | 'execution_unverified' | 'exit_claim_without_run';
/** A bounded diagnostic names its machine-readable kind and relative evidence location. */
export interface CloseoutFinding { code: CloseoutFindingCode; file: string; detail: string }
/** One comparison: null denotes absence; opaque entries retain identity without claiming textual evidence. */
export interface CloseoutChange { file: string; before: string | null; after: string | null; opaque?: boolean }
/** A fresh named test assertion, never a stored exit-status claim. */
export interface CloseoutTest { name: string; result: 'passed' | 'failed' | 'skipped'; command: number }
/** Compact provenance for one acceptance assertion. */
export interface CloseoutCriterion { id: string; criterion: string; verdict: 'proven' | 'unproven' | 'contradicted'; evidence: { test: string; result: string; file: string; comment_id: string }[] }
/** Every skipped check carries a reason; findings determine whether a gap blocks closeout. */
export interface CloseoutSkip { check: string; reason: string }
/** A closeout receipt never changes lifecycle state or records a closure. */
export interface CloseoutReport { id: string; ok: boolean; baseline: string; revert_check: 'not_requested' | 'sensitive' | 'survived' | 'inconclusive'; criteria: CloseoutCriterion[]; findings: CloseoutFinding[]; skipped: CloseoutSkip[]; tests: CloseoutTest[]; commands: { command: string; result: string }[] }
/** Options shared by SDK consumers and the registered host command. */
export interface CloseoutOptions { cwd: string; pmRoot: string; base?: string; timeoutSeconds?: number; revertCheck?: boolean }
