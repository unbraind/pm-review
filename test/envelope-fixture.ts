import type { ReviewEvidenceEnvelope } from '../src/envelope-types.ts';
/** Synthetic document review demonstrates revisions independent of Git commits. */
export function envelope(): ReviewEvidenceEnvelope {
  return { version: 1, source: { provider: 'document-review', origin: 'https://reviews.example.org', artifact: 'review-42', revision: 'doc-v3', subject: 'urn:example:document:api-contract', url: 'https://reviews.example.org/reviews/42', reviewer: 'contract-reviewer' }, provenance: { kind: 'declared' }, findings: [{ id: 'boundary', summary: 'Clarify the invalid input boundary', body: 'The API contract omits the invalid input response. Specify the error code before publishing.', path: 'docs/api.md', line: 12 }, { id: 'timeout', summary: 'State the timeout behavior', body: 'Document whether timeout cancels the operation and whether retries are safe.' }] };
}
