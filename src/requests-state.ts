import type { GetResult, HistoryResult, PmClient } from '@unbrained/pm-cli/sdk';
import { scopeDigest } from './scope-state.ts';
import type { EvidenceArrival, EvidenceArrivalRejection, EvidenceRequest } from './requests-types.ts';

/** Complete SDK state plus its durable history address, including identical-content replays. */
export interface RequestSnapshot { item: GetResult['item']; version: number }

/** Reconstruct the latest audited revision and compare it with the current SDK projection. */
export async function requestSnapshot(client: PmClient, id: string): Promise<RequestSnapshot | undefined> {
  try {
    const history = await client.run('history', { id, options: { limit: '1', compact: true, verify: true } }) as HistoryResult;
    const version = history.version_addressing ? history.version_addressing.last_version : history.compact_history?.at(-1)?.index;
    if (!history.verification?.ok || !Number.isSafeInteger(version) || Number(version) < 1) return undefined;
    const historical = await client.get(id, { full: true, at: String(version) });
    const current = await client.get(id, { full: true });
    if (current.item.id !== id || historical.as_of_version !== version || scopeDigest(historical.item) !== scopeDigest(current.item)) return undefined;
    return { item: current.item, version: version as number };
  } catch { /* Missing, foreign or unverifiable records cannot discharge an obligation. */ }
  return undefined;
}

/** Status identities and roles come from the backend's configured registry, never names. */
export async function requestStatuses(client: PmClient): Promise<Map<string, string[]>> {
  const schema = await client.schemaList();
  return new Map([...schema.statuses.builtin, ...schema.statuses.custom].map(/** Keep only semantic lifecycle data for observation checks. */ row => [row.id, row.roles]));
}

/** Arrival is an explicit one-artifact declaration, not proof of correctness or execution. */
export function arrivalReason(request: EvidenceRequest, arrival: EvidenceArrival, source: RequestSnapshot | undefined): EvidenceArrivalRejection | undefined {
  if (!source) return 'evidence_unavailable';
  if (source.version !== arrival.version) return 'evidence_changed';
  if (arrival.field !== (request.missing === 'source' ? 'files' : 'tests')) return 'evidence_type_mismatch';
  const link = source.item[arrival.field]?.[arrival.index];
  if (!link || !source.item.description?.trim()) return 'artifact_missing';
  if (request.missing === 'source' && (!link.path || request.path && link.path !== request.path)) return 'source_path_mismatch';
  if (request.missing === 'test' && !('command' in link && typeof link.command === 'string' && link.command.trim() || link.path)) return 'artifact_missing';
  return undefined;
}
