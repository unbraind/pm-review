# Cross-provider finding lineage

A review finding can appear in two providers or return at a later revision. Keep
the imported observations separate, then explicitly confirm that they describe
one logical finding. Core `pm duplicates` and `pm jev dedupe` can supply candidate
ids. Candidate relationships and similarity scores never confirm review identity.

```sh
# Read-only: inspect the proposed canonical id, score and current revision hash.
pm review lineage observation-a --with observation-b --json
# After reviewing both original observations:
pm review lineage observation-a --with observation-b --confirm \
  --revision HASH_FROM_PROPOSAL \
  --reason 'Both identify the same unchecked input before the write'
pm review lineage observation-b
# The existing verdict command now writes the canonical disposition.
pm review verdict observation-b fix --repo example/package --pr 1 \
  --reason 'Validated the input once for both observations' --commit COMMIT_SHA
```

The canonical item is the lexically smallest item id in a confirmed connected
group. The proposal names it before confirmation. Each observation keeps its own
provider, source node, body, URL, commit revision, lifecycle and item history.
Confirmations are attributed `review-lineage/v1` PM comments, appended through the
SDK with lock-scoped replay protection. Groups converge deterministically even
when confirmations form cycles. A confirmation cannot silently discard a different
local disposition: first record the intended verdict, exact reason and commit on
the proposed canonical item, then read a fresh proposal and confirm it. Existing
noncanonical decisions remain historical reasoning, available through `pm get`,
`pm comments` and `pm history`. They are never deleted or rewritten.

One current disposition is projected onto every observation for round gates,
responses, source lookup and verdict writes. Provider-specific replies still name
the individual source thread. Precedents return the canonical item once, avoiding
multiple fix decisions across transports. Raw `pm get` shows the original stored
observation, including any historical verdict; use `review lineage` for the current
canonical disposition. Confirmation does not copy claims about tests or approval.

A complete provider re-import marks absent observations `review_withdrawn=true`.
It retains their source text, local reasoning, canonical disposition and group.
Reappearance clears withdrawal; source edits and revisions remain in native PM
history. Re-import uses the same node-derived item ids and does not create another
disposition. Import receipts name each observation's canonical item and effective
verdict, and count newly withdrawn sources separately. Only pass complete provider
snapshots to `importFindings`; incomplete provider reads must fail before import,
as the existing GitHub transport does.

The typed SDK has the same semantics:

```ts
import { PmClient } from '@unbrained/pm-cli/sdk';
import { findingLineage } from 'pm-review';
import type { LineageResult } from 'pm-review';

const client = new PmClient({ cwd: process.cwd(), author: 'review-agent' });
const proposal: LineageResult = await findingLineage(client, 'observation-a', {
  with: 'observation-b',
});
if (proposal.ok && proposal.proposal && !proposal.proposal.confirmed) {
  // Call only after assessing both observations and the proposed canonical item.
  const confirmed = await findingLineage(client, proposal.id, {
    with: proposal.proposal.with,
    confirm: true,
    revision: proposal.revision,
    reason: 'Both identify the same unchecked input before the write',
  });
  console.log(confirmed);
}
```

`LineageOptions`, `LineageView`, `LineageResult` and `LineageCode` are exported.
TOON is the host default and `--json` returns the same compact receipt. Neither
format includes source bodies, excerpts or complete history. The receipt lists
observation identities, providers, revisions, URLs, withdrawal flags and one
canonical disposition. Read the source items separately when reviewing a match.
Expected refusals are `{ok:false,id,refusal:{code,remedy}}`; the CLI also returns
exit status 1. Codes cover missing findings, invalid pairs, stale revisions,
missing reasoning, malformed confirmation records and conflicting dispositions.

The feature uses complete backend-neutral SDK reads, core similarity scoring,
idempotent attributed comments and ordinary audited item mutations. It requires
neither git nor provider credentials after import. Concurrent confirmations append
independent edges rather than replacing a shared membership field; a fresh read
computes the canonical representative. As with ordinary PM writes, re-read after
concurrent changes before making another decision. The proposal hash is a snapshot
binding, not an exclusive reservation of both source items.
