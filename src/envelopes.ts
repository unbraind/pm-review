import { createHash } from 'node:crypto';
import type { ItemMetadata, PmClient } from '@unbrained/pm-cli/sdk';
import { ensureReviewSchema, fieldOptions, REVIEW_TYPE } from './tracker.ts';
import { envelopeRefusal, validateEnvelope } from './envelope-validation.ts';
import type { EnvelopeResult } from './envelope-types.ts';

/** Hash structured identities without delimiter collisions across provider namespaces. */
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Bind an observation to its canonical source identity and content. */
function matches(item: ItemMetadata, digest: string): boolean {
  return item.type === REVIEW_TYPE.name && item.review_artifact_digest === digest;
}

/** Import immutable observations using complete SDK reads and native create/history semantics. */
export async function importEvidenceEnvelope(client: PmClient, input: unknown): Promise<EnvelopeResult> {
  const envelope = validateEnvelope(input);
  if ('ok' in envelope) return envelope;
  const { source } = envelope;
  const scope = hash([source.provider, source.origin, source.artifact, source.revision]);
  const rows = envelope.findings.map(/** Revisions remain separate observations; local decisions are never overwritten by replay. */ finding => ({ finding, digest: hash([source, finding]), node: `envelope:${hash([scope, finding.id])}`, id: `ev-${hash([scope, finding.id]).slice(0, 32)}` }));
  const existing = (await client.listAllComplete()).items;
  if (rows.some(/** Refuse conflicting observations before any artifact writes. */ row => existing.some(/** Detect occupied deterministic ids, including ordinary tasks. */ item => (item.review_node_id === row.node || item.id === row.id || item.id.endsWith(`-${row.id}`)) && !matches(item, row.digest)))) return envelopeRefusal('identity_conflict');
  await ensureReviewSchema(client);
  const receipt: EnvelopeResult = { ok: true, provider: source.provider, revision: source.revision, created: 0, reused: 0, completion: 'unverified', items: [] };
  for (const { finding, node, id, digest } of rows) {
    let item = existing.find(/** Namespaced source identity prevents GitHub node collisions. */ row => row.review_node_id === node);
    if (!item) {
      const fields = fieldOptions({ review_provider: source.provider, review_origin: source.origin, review_artifact: source.artifact, review_envelope_scope: scope, review_artifact_digest: digest, review_provenance: 'declared', review_subject: source.subject, review_bot: source.reviewer, review_kind: 'review', review_path: finding.path ?? '', review_line: finding.line ?? 0, review_summary: finding.summary, review_url: source.url, review_node_id: node, review_head: source.revision, review_head_source: 'envelope', review_verdict: 'pending', review_verdict_source: 'import' });
      try {
        item = (await client.create({ ...fields, id, type: REVIEW_TYPE.name, title: `${source.reviewer}: ${finding.summary}`, description: finding.body, body: `Source: ${source.url}\n\n${finding.body}` })).item;
        receipt.created++;
      } catch (error) {
        // A racing writer may have reserved this deterministic id through the SDK lock.
        item = (await client.listAllComplete()).items.find(/** Re-read only after a native create failure. */ row => row.review_node_id === node);
        if (!item) throw error;
        if (!matches(item, digest)) return envelopeRefusal('identity_conflict');
        receipt.reused++;
      }
    } else receipt.reused++;
    receipt.items.push({ id: item.id, finding: finding.id });
  }
  return receipt;
}
