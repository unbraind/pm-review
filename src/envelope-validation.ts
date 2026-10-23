import type { EnvelopeCode, EnvelopeRefusal, ReviewEvidenceEnvelope } from './envelope-types.ts';

/** Fixed remedies never echo artifact content, credentials or local paths. */
const REMEDIES: Record<EnvelopeCode, string> = {
  envelope_invalid: 'Use review-evidence version 1 with a valid source and 1 to 50 distinct findings; see the documented example.',
  provenance_unsupported: 'Export provenance.kind=declared. Artifact assertions cannot establish completion; use a supported live review adapter for completion evidence.',
  identity_conflict: 'Preserve the existing observation. Export changed review content under a new source revision.',
  artifact_unavailable: 'Check the explicit regular file or HTTP(S) URL. HTTP must return 200 without redirects within 10 seconds; credentials are never forwarded.',
  artifact_too_large: 'Export an artifact of at most 1 MiB and split larger reviews into separately identified artifacts.',
  digest_mismatch: 'Obtain the artifact SHA-256 independently, verify the source, and supply the matching lowercase digest.',
  input_invalid: 'Supply exactly one --file or --url and a lowercase 64-character --sha256 digest; URLs must use HTTP(S) without embedded credentials.',
};

/** Construct machine-readable failure data shared by ingestion boundaries. */
export function envelopeRefusal(code: EnvelopeCode): EnvelopeRefusal {
  return { ok: false, refusal: { code, remedy: REMEDIES[code] } };
}

/** Narrow unknown JSON without trusting provider-controlled prototypes or arrays. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Require bounded nonempty strings without hidden whitespace identity aliases. */
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Reject credentials and bind source links to one canonical HTTPS authority. */
function sourceUrls(source: Record<string, unknown>): boolean {
  try {
    const origin = new URL(String(source.origin));
    const url = new URL(String(source.url));
    return origin.protocol === 'https:' && origin.origin === source.origin && url.origin === origin.origin && !url.username && !url.password;
  } catch { return false; }
}

/** Validate the entire artifact before schema or item mutations; reject unsupported trust claims. */
export function validateEnvelope(value: unknown): ReviewEvidenceEnvelope | EnvelopeRefusal {
  if (!record(value) || value.version !== 1 || !record(value.source) || !record(value.provenance) || !Array.isArray(value.findings)) return envelopeRefusal('envelope_invalid');
  if (value.provenance.kind !== 'declared' || Object.keys(value.provenance).length !== 1) return envelopeRefusal('provenance_unsupported');
  const source = value.source;
  if (Object.keys(value).sort().join(',') !== 'findings,provenance,source,version' || Object.keys(source).sort().join(',') !== 'artifact,origin,provider,reviewer,revision,subject,url'
    || !Object.values(source).every(/** All source selectors use bounded, explicit identities. */ field => text(field, 2048)) || !/^[a-z][a-z0-9.-]{0,63}$/.test(String(source.provider)) || !sourceUrls(source)) return envelopeRefusal('envelope_invalid');
  if (value.findings.length < 1 || value.findings.length > 50) return envelopeRefusal('envelope_invalid');
  const ids = new Set<string>();
  for (const finding of value.findings) {
    if (!record(finding) || Object.keys(finding).some(/** Unknown fields cannot smuggle completion or verdict semantics. */ key => !['id', 'summary', 'body', 'path', 'line'].includes(key))
      || !text(finding.id, 256) || !text(finding.summary, 200) || typeof finding.body !== 'string' || !finding.body.trim() || finding.body.length > 16000
      || (finding.path !== undefined && !text(finding.path, 1024)) || (finding.line !== undefined && (!Number.isSafeInteger(finding.line) || Number(finding.line) < 1)) || ids.has(finding.id)) return envelopeRefusal('envelope_invalid');
    ids.add(finding.id);
  }
  // Reconstruct a canonical key order so JSON property order cannot change replay identity.
  return { version: 1, source: { provider: String(source.provider), origin: String(source.origin), artifact: String(source.artifact), revision: String(source.revision), subject: String(source.subject), url: String(source.url), reviewer: String(source.reviewer) }, provenance: { kind: 'declared' }, findings: value.findings.map(/** Sort separately below so producer row order does not change immutable artifact content. */ row => ({ id: row.id as string, summary: row.summary as string, body: row.body as string, ...(row.path === undefined ? {} : { path: row.path as string }), ...(row.line === undefined ? {} : { line: row.line as number }) })).sort(/** Canonical ordering makes file and HTTP replay identical. */ (a, b) => a.id.localeCompare(b.id)) };
}
