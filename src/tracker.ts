import { createHash } from 'node:crypto';
import { PmClient } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { SchemaFieldDefinition, SchemaItemTypeDefinition } from '@unbrained/pm-cli/sdk/authoring';
import { VERDICTS } from './types.ts';
import type { Finding, PullRequest, Verdict } from './types.ts';

/** Registered item identity separates review context from ordinary planned work. */
export const REVIEW_TYPE: SchemaItemTypeDefinition = { name: 'ReviewFinding', folder: 'review-findings', description: 'Bot finding with source identity, decision reasoning and commit provenance', default_status: 'open' };
/** Namespaced fields remain optional for non-review item types in a shared tracker. */
export const REVIEW_FIELDS: SchemaFieldDefinition[] = [
  ...['bot', 'path', 'severity', 'summary', 'url', 'node_id', 'head', 'repo', 'thread_id', 'reason', 'commit', 'commits', 'head_source'].map(/** Register textual provenance without clashing with built-in fields. */ name => ({ name: `review_${name}`, type: 'string' as const, optional: true })),
  { name: 'review_kind', type: 'string', optional: true, values: ['thread', 'review', 'comment'] },
  { name: 'review_verdict', type: 'string', optional: true, values: [...VERDICTS] },
  { name: 'review_verdict_source', type: 'string', optional: true, values: ['import', 'local'] },
  { name: 'review_pr', type: 'number', optional: true },
  { name: 'review_line', type: 'number', optional: true },
  { name: 'review_resolved', type: 'boolean', optional: true },
];

/** Ensure persisted schema remains readable by pm search even without an active extension. */
export async function ensureReviewSchema(client: PmClient): Promise<void> {
  const schema = await client.schemaList();
  if (!schema.custom.some(/** Persist the package type independently of runtime registration. */ type => type.name === REVIEW_TYPE.name)) {
    await client.schemaAddType(REVIEW_TYPE.name, { folder: REVIEW_TYPE.folder, description: REVIEW_TYPE.description });
  }
  const fields = await client.schemaListFields();
  for (const field of REVIEW_FIELDS) {
    const existing = fields.fields.find(/** Match persisted fields by canonical metadata name. */ definition => definition.key === field.name);
    if (existing && existing.type !== field.type) throw new Error(`Incompatible schema field: ${field.name}`);
    if (!existing) await client.run('schema', { name: field.name, options: { subcommand: 'add-field', fieldType: field.type } });
  }
}

/** Convert metadata names into the SDK's runtime option spellings. */
export function fieldOptions(fields: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(fields).map(/** Camel case matches schemaAddField's canonical option contract. */ ([name, value]) => [name.replace(/_([a-z])/g, /** Capitalize only the letter following a metadata separator. */ (_match, letter: string) => letter.toUpperCase()), value]));
}

/** Read every review item, including terminal verdict precedents, through the complete SDK reader. */
export async function reviewItems(client: PmClient): Promise<ItemMetadata[]> {
  return (await client.listAllComplete()).items.filter(/** Package-owned typed items are the only review corpus. */ item => item.type === REVIEW_TYPE.name);
}

/** Receipt names durable identities so callers can follow up with verdict commands. */
export interface ImportReceipt { repo: string; pr: number; head: string; created: number; updated: number; items: { id: string; node_id: string; verdict: string }[] }

/** Upsert complete findings using stable node-derived ids, preserving every local decision. */
export async function importFindings(client: PmClient, pr: PullRequest, findings: Finding[]): Promise<ImportReceipt> {
  await ensureReviewSchema(client);
  const existing = new Map((await reviewItems(client)).map(/** GitHub node ids identify the same source across imports and PRs. */ item => [String(item.review_node_id), item]));
  const receipt: ImportReceipt = { repo: pr.repo, pr: pr.number, head: pr.head, created: 0, updated: 0, items: [] };
  for (const finding of findings) {
    const prior = existing.get(finding.id);
    // Legacy explicit decisions always retained a reason; final actionable verdicts also remain local.
    const local = prior !== undefined && (prior.review_verdict_source === 'local' || Boolean(prior.review_reason) || Boolean(prior.review_commit) || !['pending', 'informational'].includes(String(prior.review_verdict)));
    const verdict = local ? String(prior.review_verdict) : finding.verdict;
    const fields = fieldOptions({ review_bot: finding.bot, review_kind: finding.kind, review_path: finding.path, review_line: finding.line ?? 0, review_severity: finding.severity, review_summary: finding.summary, review_url: finding.url, review_node_id: finding.id, review_head: finding.head ?? '', review_head_source: finding.head === null ? 'unknown' : 'github', review_verdict: verdict, review_verdict_source: local ? 'local' : 'import', review_resolved: finding.resolved, review_repo: pr.repo, review_pr: pr.number, review_thread_id: finding.thread, review_commits: pr.commits.map(/** Retain both commit identity and its public source link. */ commit => `${commit.sha} ${commit.url}`).join('\n') });
    const options = { ...fields, title: `${finding.bot}: ${finding.summary}`, description: finding.body, body: `Source: ${finding.url}\n\n${finding.body}\n\nPR commits:\n${pr.commits.map(/** Commit links connect the review context to the code under discussion. */ commit => `- [${commit.sha}](${commit.url})`).join('\n')}` };
    let item: ItemMetadata;
    if (prior) {
      await client.update(prior.id, options);
      item = prior;
      receipt.updated++;
    } else {
      item = (await client.create({ ...options, id: `gh-${createHash('sha256').update(finding.id).digest('hex').slice(0, 24)}`, type: REVIEW_TYPE.name })).item;
      receipt.created++;
      existing.set(finding.id, item);
    }
    if (finding.verdict === 'informational') {
      await closeFinding(client, item, `informational: ${finding.url}`);
    } else if (prior?.status === 'closed' && prior.review_verdict_source === 'import' && String(prior.resolution).startsWith('informational:')) {
      await client.update(item.id, { status: 'open' });
    }
    receipt.items.push({ id: item.id, node_id: finding.id, verdict });
  }
  return receipt;
}

/** Persist a local verdict and replay-safe audit comment through the SDK mutation pipeline. */
export async function recordVerdict(client: PmClient, item: ItemMetadata, verdict: Verdict, reason: string, commit: string): Promise<void> {
  await client.comments(item.id, { add: `pm-review ${verdict}: ${reason}${commit ? `\nCommit: ${commit}` : ''}`, ifAbsent: true });
  await client.update(item.id, fieldOptions({ review_verdict: verdict, review_verdict_source: 'local', review_reason: reason, review_commit: commit }));
}

/** Search every prior fix or refusal using all query words across source text and retained reasoning. */
export async function precedents(client: PmClient, query: string, repo?: string, pr?: number): Promise<{ id: string; verdict: string; summary: string; reason: string; url: string; commit: string }[]> {
  const words = query.trim().toLowerCase().split(/\s+/);
  if (!query.trim()) throw new Error('A nonempty precedent query is required');
  return (await reviewItems(client)).filter(/** Current and terminal decisions are eligible; optional PR flags narrow only on request. */ item => (item.review_verdict === 'fix' || item.review_verdict === 'refuse') && (repo === undefined || item.review_repo === repo) && (pr === undefined || item.review_pr === pr) && words.every(/** Match source findings and decision reasoning without contacting a provider. */ word => `${item.title} ${item.description} ${String(item.review_reason)}`.toLowerCase().includes(word))).map(/** Return a compact precedent that links back to both item and source. */ item => ({ id: item.id, verdict: String(item.review_verdict), summary: String(item.review_summary), reason: String(item.review_reason), url: String(item.review_url), commit: String(item.review_commit) }));
}

/** Find imported source identities locally across the complete tracker, without GitHub reads. */
export async function findReviewItems(client: PmClient, source: string): Promise<ItemMetadata[]> {
  if (!/^PRRT_[A-Za-z0-9_-]+$/.test(source) && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*#(?:discussion_r|issuecomment-|pullrequestreview-)\d+$/.test(source)) throw new Error('--thread requires a PRRT_ thread id or a GitHub review-comment URL');
  return (await reviewItems(client)).filter(/** URLs identify the imported root comment; ids identify its thread. */ item => item.review_thread_id === source || item.review_url === source);
}

/** Close source context once, retaining structured lifecycle evidence in one SDK call. */
export async function closeFinding(client: PmClient, item: ItemMetadata, evidence: string): Promise<void> {
  if (item.status === 'closed') return;
  await client.close(item.id, evidence, { resolution: evidence, expectedResult: 'Review source requires no further action', actualResult: evidence });
}
