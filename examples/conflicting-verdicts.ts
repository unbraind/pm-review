import { reviewConflicts, serializeConflictWitness } from '../index.ts';
import type { PmClient } from '@unbrained/pm-cli/sdk';

/** Supply the host's client and an existing confirmed lineage at an exact artifact revision. */
export async function conflictExample(client: PmClient): Promise<string> {
  return serializeConflictWitness(await reviewConflicts(client, {
    schema: 'review-conflicts/v1', item: 'sample-finding', revision: 'document-v3',
  }), 'toon');
}
