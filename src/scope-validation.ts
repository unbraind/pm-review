import { isRuntimeRecord } from '@unbrained/pm-cli/sdk';
import type { CarryForwardReport, ReviewScope, ScopeSelection } from './scope-types.ts';

/** One bounded schema vocabulary for declarations and the receipts they produce. */
type Rule = (value: unknown) => boolean;

/** Require exactly the declared own properties, including for SDK callers. */
function record(shape: Record<string, Rule>): Rule {
  return value => isRuntimeRecord(value) && Object.keys(value).length === Object.keys(shape).length && Object.entries(shape).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
}

/** Iteration makes holes explicit undefined values, which no element schema accepts. */
function array(rule: Rule, min: number, max: number, key?: string): Rule {
  return value => Array.isArray(value) && value.length >= min && value.length <= max && Object.keys(value).length === value.length && [...value].every(rule) && new Set(value.map(entry => key ? (entry as Record<string, unknown>)[key] : entry)).size === value.length;
}

/** Keep native literals exact; the SDK owns field normalization and historical values. */
function text(min: number, max: number, pattern: RegExp): Rule {
  return value => typeof value === 'string' && value.trim().length >= min && value.length <= max && pattern.test(value);
}

const version: Rule = value => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) < Number.MAX_SAFE_INTEGER;
const id = text(1, 1000, /\S/);
const digest = text(64, 64, /^[a-f0-9]{64}$/);
const field = text(1, 200, /^[a-z][a-z0-9_]*$/);
const criterion = text(3, 16, /^AC[1-9]\d*$/);
const judgment: Rule = value => value === 'reviewed' || value === 'gap';
const common = { version, author: text(1, 200, /\S/), reason: text(12, 1000, /\S/) };
const obligation = { criterion, judgment };
const selection = record({ ...common, obligations: array(record({ ...obligation, fields: array(field, 1, 16), evidence: array(record({ id, version }), 0, 16, 'id') }), 0, 32, 'criterion') });
const receipt = record({ ...common, ok: value => value === true, schema: value => value === 'review-scope/v1', id, artifact: digest, obligations: array(record({ ...obligation, digest, fields: array(record({ name: field, digest }), 1, 16, 'name'), evidence: array(record({ id, version, digest }), 0, 16, 'id') }), 0, 32, 'criterion') });

/** Validate both wire forms with the same schema, before any historical SDK reads. */
export function parseScopeInput(value: unknown, captured: true): ReviewScope | undefined;
/** Validate a declaration with the same native selectors used by captured receipts. */
export function parseScopeInput(value: unknown, captured: false): ScopeSelection | undefined;
/** Enforce the CLI byte limit for in-process callers as well. */
export function parseScopeInput(value: unknown, captured: boolean): ReviewScope | ScopeSelection | undefined {
  if (!(captured ? receipt : selection)(value) || Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024) return undefined;
  return value as ReviewScope | ScopeSelection;
}

/** Count-derived decisions remain exact nonnegative integers; no display ratios enter judgments. */
const count: Rule = value => Number.isSafeInteger(value) && Number(value) >= 0;
const reportNumbers = record({ from: version, unchanged: count, stale: count, never_reviewed: count, removed: count });

/** Check every emitted number using the same version domain as the input schema. */
export function validScopeNumbers(value: ReviewScope | CarryForwardReport): boolean {
  return 'version' in value ? version(value.version) && value.obligations.every(row => row.evidence.every(source => version(source.version))) : reportNumbers({ from: value.from, ...value.counts });
}
