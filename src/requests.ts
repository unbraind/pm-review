import type { PmClient } from '@unbrained/pm-cli/sdk';
import { reviewCoverage } from './coverage.ts';
import type { CoverageResult } from './coverage-types.ts';
import { fileBytes } from './envelope-artifact.ts';
import { scopeDigest } from './scope-state.ts';
import { arrivalReason, requestSnapshot, requestStatuses } from './requests-state.ts';
import { finalizeReviewOutput, reviewTextExcerpt } from './output-budget.ts';
import type { RequestSnapshot } from './requests-state.ts';
import { requestInput, requestRefusal } from './requests-validation.ts';
import type { EvidenceOutputFormat, EvidenceRequest, EvidenceRequestQueue, EvidenceRequestResult, EvidenceSelection, EvidenceSelectionSkip } from './requests-types.ts';

/** Resolve one obligation through existing coverage semantics and native status roles. */
async function obligation(client: PmClient, selection: EvidenceSelection, snapshot: RequestSnapshot | undefined, statuses: Map<string, string[]>): Promise<{ text: string } | { reason: EvidenceSelectionSkip }> {
  if (!snapshot) return { reason: 'item_unavailable' };
  const { item } = snapshot;
  const roles = statuses.get(String(item.status));
  if (!roles) return { reason: 'status_unknown' };
  if (roles.some(/** Done and canceled statuses both retire the current obligation. */ role => role === 'terminal' || role === 'terminal_done' || role === 'terminal_canceled')) return { reason: 'obligation_terminal' };
  if (selection.obligation === 'finding') {
    if (item.type !== 'ReviewFinding') return { reason: 'not_review_finding' };
    if (item.review_resolved === true || item.review_withdrawn === true) return { reason: 'finding_resolved' };
    return { text: String(item.review_summary || item.title) };
  }
  let coverage: CoverageResult;
  try { coverage = await reviewCoverage(client, item.id); }
  catch { return { reason: 'coverage_unavailable' }; }
  if (!coverage.ok) return { reason: coverage.refusal.code };
  const criterion = coverage.criteria.find(/** Reuse the package's current criterion identifiers and gap logic. */ row => row.id === selection.obligation);
  if (!criterion) return { reason: 'criterion_unknown' };
  if (criterion.state === 'reviewed') return { reason: 'criterion_reviewed' };
  return { text: criterion.text };
}

/** Compile revision-bound acquisition requests without writes, provider calls, git or test execution. */
export async function reviewEvidenceRequests(client: PmClient, input: unknown, format: EvidenceOutputFormat = 'json'): Promise<EvidenceRequestResult> {
  const packet = requestInput(input);
  if (!packet || (format !== 'json' && format !== 'toon')) return requestRefusal('input_invalid');
  const statuses = await requestStatuses(client);
  const ids = [...new Set([...packet.select.map(/** Share SDK observations across selections. */ row => row.item), ...packet.arrivals.map(/** Unmatched arrivals remain explicit refused records. */ row => row.item)])];
  const snapshots = new Map<string, RequestSnapshot | undefined>();
  for (const id of ids) snapshots.set(id, await requestSnapshot(client, id));
  const obligations = [];
  for (const selection of packet.select) obligations.push(await obligation(client, selection, snapshots.get(selection.item), statuses));
  const queue: EvidenceRequestQueue = { ok: true, schema: 'review-requests/v1', approval: 'unverified', consistency: 'observed', total: packet.select.length, pending: 0, characters: 0, requests: [], omitted: [], satisfied: [], skipped: [], rejected: [] };
  const pending: EvidenceRequest[] = [];
  const matched = new Set<number>();
  for (const [index, selection] of packet.select.entries()) {
    const result = obligations[index];
    if ('reason' in result) { queue.skipped.push({ selection: index, reason: result.reason }); continue; }
    const snapshot = snapshots.get(selection.item)!;
    const path = selection.obligation === 'finding' ? String(snapshot.item.review_path ?? '') : '';
    const line = selection.obligation === 'finding' ? Number(snapshot.item.review_line ?? 0) : 0;
    if (path.length > 256) { queue.skipped.push({ selection: index, reason: 'source_path_too_large' }); continue; }
    const excerpt = reviewTextExcerpt(result.text);
    const request: EvidenceRequest = { ...selection, key: scopeDigest(['review-requests/v1', selection, snapshot.version, scopeDigest(snapshot.item)]), version: snapshot.version, text: excerpt.text, text_omitted: excerpt.omitted, path, line, ask: selection.missing === 'source' ? 'Provide one source excerpt for this obligation in an evidence item description with one native files link.' : 'Provide one focused test artifact for this obligation in an evidence item description with one native tests link.' };
    const arrivalIndex = packet.arrivals.findIndex(/** Only an explicit exact request key can discharge this obligation. */ row => row.request === request.key);
    if (arrivalIndex >= 0) {
      matched.add(arrivalIndex);
      const arrival = packet.arrivals[arrivalIndex];
      const reason = arrivalReason(request, arrival, snapshots.get(arrival.item));
      if (!reason) { queue.satisfied.push({ key: request.key, item: arrival.item, version: arrival.version }); continue; }
      queue.rejected.push({ arrival: arrivalIndex, reason });
    }
    pending.push(request);
  }
  for (const [index] of packet.arrivals.entries()) if (!matched.has(index)) queue.rejected.push({ arrival: index, reason: 'request_not_current' });
  // Double observation detects interleavings, including A-B-A replays and registry changes.
  for (const id of [...ids].reverse()) if (scopeDigest(await requestSnapshot(client, id) ?? null) !== scopeDigest(snapshots.get(id) ?? null)) return requestRefusal('state_changed');
  for (const [index, selection] of packet.select.entries()) if (scopeDigest(await obligation(client, selection, snapshots.get(selection.item), statuses)) !== scopeDigest(obligations[index])) return requestRefusal('state_changed');
  if (scopeDigest([...await requestStatuses(client)]) !== scopeDigest([...statuses])) return requestRefusal('state_changed');
  return finalizeReviewOutput(queue, pending, packet.budget, format);
}

/** Use the shared bounded artifact loader and the same strict packet schema as SDK callers. */
export async function reviewEvidenceRequestsFile(client: PmClient, file: string, format: EvidenceOutputFormat = 'json'): Promise<EvidenceRequestResult> {
  let input: unknown;
  try {
    const bytes = await fileBytes(file);
    if (!bytes) return requestRefusal('file_unavailable');
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return requestRefusal('file_unavailable'); }
  return reviewEvidenceRequests(client, input, format);
}
