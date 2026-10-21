import { createHash } from 'node:crypto';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { itemEvidence } from './closeout.ts';
import { isInformational } from './findings.ts';
import type { CoverOptions, CoverageBinding, CoverageCode, CoverageJudgment, CoverageMap, CoverageRefusal, CoverageResult } from './coverage-types.ts';

/** Versioned comments use PM attribution and its existing mutation/history pipeline. */
const PREFIX = 'review-coverage/v1 ';
/** Fixed remedies make every refusal actionable without repeating source bodies. */
const REMEDIES: Record<CoverageCode, string> = {
  criteria_missing: 'Declare acceptance_criteria on the target item, including any risk criteria.',
  criterion_unknown: 'Read review coverage and select a current AC identifier.',
  criteria_changed: 'Read the new revision and reassess the mapping against the changed criteria.',
  evidence_missing: 'Import the review finding and select its tracker item id.',
  evidence_ineligible: 'Use substantive review text with reviewer, source URL and known commit; notices cover zero criteria.',
  evidence_changed: 'Reassess the changed review evidence and record a new mapping.',
  judgment_invalid: 'Supply judgment reviewed|gap, an exact excerpt of 24 to 1000 characters, and a reason of 12 to 1000 characters.',
  mapping_invalid: 'Append a valid mapping through review cover; preserve the invalid record for audit.',
};

/** Content hashes bind the complete criterion contract and original source provenance. */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Construct one typed refusal from the shared stable vocabulary. */
function refusal(code: CoverageCode): CoverageRefusal {
  return { code, remedy: REMEDIES[code] };
}

/** Bind source text and all identity fields; mutable verdicts do not change review content. */
function sourceDigest(item: ItemMetadata): string {
  return digest([item.description, item.review_node_id, item.review_repo, item.review_pr, item.review_bot, item.review_url, item.review_head, item.review_kind]);
}

/** Fail closed on service notices even when they include severity markers or a claimed mapping. */
function eligible(item: ItemMetadata): boolean {
  const body = item.description;
  return body.trim().length >= 24 && item.type === 'ReviewFinding' && typeof item.review_bot === 'string' && item.review_bot.trim().length > 0
    && typeof item.review_node_id === 'string' && item.review_node_id.length > 0
    && typeof item.review_repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(item.review_repo)
    && Number.isSafeInteger(item.review_pr) && Number(item.review_pr) > 0
    && typeof item.review_url === 'string' && item.review_url.startsWith(`https://github.com/${item.review_repo}/pull/${String(item.review_pr)}#`)
    && typeof item.review_head === 'string' && /^[a-f0-9]{40,64}$/i.test(item.review_head)
    && !isInformational(body)
    && !/quota|rate[- ]limit|review skipped|skipped review|review failed|review unavailable|review (?:was |is )?(?:not (?:performed|completed)|cancelled|canceled)|trial (?:has )?ended|review budget|no access|failed to (?:review|generate)/i.test(body);
}

/** Validate persisted and CLI bindings identically instead of trusting stored JSON. */
function bindingOf(value: unknown): CoverageBinding | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['revision', 'criterion', 'evidence', 'digest', 'excerpt', 'reason']) if (typeof record[key] !== 'string') return undefined;
  if (record.judgment !== 'reviewed' && record.judgment !== 'gap') return undefined;
  return record as unknown as CoverageBinding;
}

/** Revalidate the contract, attribution selector and current evidence on every read and write. */
function validate(binding: CoverageBinding, map: CoverageMap, evidence: ItemMetadata | undefined): CoverageRefusal | undefined {
  if (binding.revision !== map.revision) return refusal('criteria_changed');
  if (!map.criteria.some(/** Criterion identity is scoped to this complete contract revision. */ row => row.id === binding.criterion)) return refusal('criterion_unknown');
  if (!evidence) return refusal('evidence_missing');
  if (!eligible(evidence)) return refusal('evidence_ineligible');
  if (binding.digest !== sourceDigest(evidence)) return refusal('evidence_changed');
  if (binding.excerpt.trim().length < 24 || binding.excerpt.length > 1000 || !evidence.description?.includes(binding.excerpt) || binding.reason.trim().length < 12 || binding.reason.length > 1000) return refusal('judgment_invalid');
  return undefined;
}

/** Read complete target and source items through the backend-neutral SDK, with no git or network. */
export async function reviewCoverage(client: PmClient, id: string): Promise<CoverageResult> {
  const item = (await client.get(id, { full: true })).item;
  const { acceptance_criteria: contract, comments } = itemEvidence(item);
  const texts = contract.split(/[;\n]/).map(/** Match the closeout criterion selector contract. */ text => text.trim()).filter(Boolean);
  if (texts.length === 0) return { ok: false, id, refusal: refusal('criteria_missing') };
  const map: CoverageMap = { ok: true, id, revision: digest(contract), total: texts.length, reviewed: 0, unreviewed: texts.length, criteria: texts.map(/** Keep criterion wording available while omitting full review bodies. */ (text, index) => ({ id: `AC${index + 1}`, text, state: 'unreviewed' })), judgments: [] };
  const sources = new Map((await client.listAllComplete()).items.map(/** Complete reads prevent terminal or paginated evidence disappearing. */ source => [source.id, source]));
  for (const [index, comment] of comments.entries()) {
    if (!comment.text.startsWith(PREFIX)) continue;
    let binding: CoverageBinding | undefined;
    try { binding = bindingOf(JSON.parse(comment.text.slice(PREFIX.length))); } catch { /* Malformed records remain visible as refused judgments. */ }
    const evidence = binding && sources.get(binding.evidence);
    const row: CoverageJudgment = { comment: index + 1, author: comment.author, date: comment.created_at, criterion: '', evidence: '', reviewer: '', url: '', head: '', judgment: 'gap', reason: '' };
    if (!binding || !comment.author.trim() || !comment.created_at.trim()) row.refusal = refusal('mapping_invalid');
    else {
      Object.assign(row, { criterion: binding.criterion, evidence: binding.evidence, judgment: binding.judgment, reason: binding.reason, reviewer: evidence?.review_bot ?? '', url: evidence?.review_url ?? '', head: evidence?.review_head ?? '' });
      row.refusal = validate(binding, map, evidence);
    }
    map.judgments.push(row);
  }
  for (const criterion of map.criteria) {
    // Last valid judgment per source wins, allowing an explicit gap to retract earlier attention claims.
    const current = new Map<string, CoverageJudgment>();
    for (const row of map.judgments) if (!row.refusal && row.criterion === criterion.id) current.set(row.evidence, row);
    const judgments = [...current.values()];
    criterion.state = judgments.some(/** A recorded gap dominates attention claims from other sources. */ row => row.judgment === 'gap') ? 'gap' : judgments.length > 0 ? 'reviewed' : 'unreviewed';
  }
  map.reviewed = map.criteria.filter(/** Only current explicit attention without an open gap counts. */ row => row.state === 'reviewed').length;
  map.unreviewed = map.total - map.reviewed;
  return map;
}

/** Record an explicit assessment as an attributed PM comment; never infer criteria from green checks. */
export async function coverCriterion(client: PmClient, id: string, options: CoverOptions): Promise<CoverageResult> {
  const map = await reviewCoverage(client, id);
  if (!map.ok) return map;
  const evidence = (await client.listAllComplete()).items.find(/** Missing evidence is a typed refusal, not an SDK item lookup exception. */ item => item.id === options.evidence);
  const raw = { ...options, digest: evidence ? sourceDigest(evidence) : '' };
  const binding = bindingOf(raw);
  const denied = binding ? validate(binding, map, evidence) : refusal('judgment_invalid');
  if (denied) return { ok: false, id, refusal: denied };
  await client.comments(id, { add: PREFIX + JSON.stringify(raw), ifAbsent: true });
  return reviewCoverage(client, id);
}
