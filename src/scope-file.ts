import type { PmClient } from '@unbrained/pm-cli/sdk';
import { fileBytes } from './envelope-artifact.ts';
import { carryForwardReview, captureReviewScope } from './scope.ts';
import { scopeRefusal } from './scope-state.ts';
import type { CarryForwardResult, ScopeResult } from './scope-types.ts';

/** Read a bounded, portable JSON declaration or receipt using the shared artifact reader. */
export async function reviewScopeFile(client: PmClient, id: string, file: string, capture: boolean): Promise<ScopeResult | CarryForwardResult> {
  let input: unknown;
  try {
    const bytes = await fileBytes(file);
    if (!bytes) return scopeRefusal('scope_unavailable');
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return scopeRefusal('scope_unavailable'); }
  return capture ? captureReviewScope(client, id, input) : carryForwardReview(client, id, input);
}
