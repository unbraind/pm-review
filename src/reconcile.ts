import { PmClient } from '@unbrained/pm-cli/sdk';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import { findingsOf, isInformational } from './findings.ts';
import { closeFinding, reviewItems } from './tracker.ts';
import type { GitHubTransport } from './types.ts';

/** Read only same-repository alert links; foreign links cannot close a local finding. */
export function alertNumbers(item: ItemMetadata, repo: string): number[] {
  const links = String(item.description).matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/security\/code-scanning\/([1-9]\d*)\b/g);
  return [...links].filter(match => match[1] === repo).map(match => Number(match[2]));
}

/** Reconciliation receipt lists exact closure evidence and distinguishes planning from mutation. */
export interface ReconcileReceipt { repo: string; pr: number; dry_run: boolean; before_open: number; after_open: number; closed: number; items: { id: string; resolution: string }[]; skipped: { id: string; reason: string }[] }

/** Persisted decisions outrank notice-like text when the source is no longer available. */
function isOrphanInformational(item: ItemMetadata): boolean {
  if (item.review_verdict) return item.review_verdict === 'informational';
  if (['critical', 'high', 'medium', 'low', 'major', 'minor'].includes(String(item.review_severity))) return false;
  return isInformational(String(item.description));
}

/** Close terminal source context using live GitHub reads; all reads finish before any tracker write. */
export async function reconcile(client: PmClient, transport: GitHubTransport, repo: string, pr: number, dryRun: boolean): Promise<ReconcileReceipt> {
  const items = (await reviewItems(client)).filter(item => item.review_repo === repo && item.review_pr === pr && Boolean(item.review_node_id || item.review_thread_id) && !['closed', 'canceled'].includes(item.status));
  const snapshot = await transport.snapshot(repo, pr);
  if (snapshot.repo !== repo || snapshot.number !== pr) throw new Error('Review snapshot does not match the requested repository and PR');
  const lifecycle = await transport.lifecycle(repo, pr, items.flatMap(item => alertNumbers(item, repo)));
  const sources = new Map(findingsOf(snapshot).map(finding => [finding.id, finding]));
  const plan: ReconcileReceipt['items'] = [];
  const skipped: ReconcileReceipt['skipped'] = [];
  for (const item of items) {
    const source = sources.get(String(item.review_node_id || item.review_thread_id));
    if (source && item.review_thread_id && item.review_thread_id !== source.thread) continue;
    const alerts = alertNumbers(item, repo).map(number => lifecycle.alerts.find(alert => alert.number === number));
    let resolution = '';
    if (source?.verdict === 'informational' || (!source && isOrphanInformational(item))) resolution = `informational: ${String(item.review_url)}`;
    else if (alerts.length > 0 && alerts.every(alert => alert !== undefined && (alert.state === 'fixed' || alert.state === 'dismissed'))) resolution = `code-scanning: ${alerts.map(alert => `${alert!.number} ${alert!.state}`).join(', ')}`;
    else if (source?.resolved) resolution = `resolved thread: ${source.thread}; ${source.url}`;
    else if (lifecycle.merged) resolution = `merged PR: https://github.com/${repo}/pull/${pr}; ${lifecycle.mergeCommit ? `merge commit ${lifecycle.mergeCommit}` : `head ${snapshot.head}`}`;
    if (resolution) plan.push({ id: item.id, resolution });
    else {
      const unavailable = (lifecycle.skippedAlerts ?? []).filter(alert => alertNumbers(item, repo).includes(alert.number));
      if (unavailable.length) skipped.push({ id: item.id, reason: `code-scanning closure skipped: ${unavailable.map(alert => `${alert.number} HTTP ${alert.status}`).join(', ')}` });
    }
  }
  if (!dryRun) {
    const byId = new Map(items.map(item => [item.id, item]));
    for (const entry of plan) await closeFinding(client, byId.get(entry.id)!, entry.resolution);
  }
  return { repo, pr, dry_run: dryRun, before_open: items.length, after_open: items.length - (dryRun ? 0 : plan.length), closed: dryRun ? 0 : plan.length, items: plan, skipped };
}
