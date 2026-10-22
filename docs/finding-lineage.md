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

The canonical observation owns the most recently recorded decision, using
`review_decided_at` and matching decision-audit timestamps. Item ids break only
equal-time ties. Initial provider decisions retain their source date; changed
import-derived verdicts receive a new observation time, and unchanged re-imports
preserve it. Legacy records without either timestamp use their original item
creation time. Reassess and record an explicit verdict when legacy chronology is
uncertain. Ordinary comments, title edits and confirmations do not advance the
decision time.

Every observation retains its provider, source node, body, URL, revision and
history. Confirmations remain attributed `review-lineage/v1` comments appended
through the SDK. Before joining independent roots, their complete dispositions
must agree, including import-derived decisions. Otherwise `disposition_conflict`
requires reassessing and recording the intended verdict, reason and commit on
both roots before a fresh confirmation. Later decisions within a confirmed group
select the new owner by decision time. The lineage view exposes differing retained
observations in `disagreements`, including after reverse or replayed links.

`review verdict` atomically updates the addressed observation's decision and audit
comment through one SDK update. It does not route a second write through a cached
canonical id. A concurrent confirmation cannot strand the decision on an old
owner: fresh reads compute the latest decision across the whole confirmed group.
Round gates, responses, source lookup, precedents and import receipts share this
effective disposition. Provider-specific replies still name their source thread;
precedents return each canonical decision once. Raw `pm get` retains original
observation fields and historical reasoning. Confirmation makes no test or
approval claim.

Malformed confirmation payloads and deleted or retyped targets are skipped and
reported as `issues` with item id, comment position, kind and remedy. Import,
round, response and status receipts expose these diagnostics; `reviewItems`
attaches them to the source observations. They do not disable unrelated review
work. Core comments and history retain the invalid evidence for inspection.

Withdrawal is opt-in for SDK callers. `importFindings(client, snapshot, findings,
{ snapshotComplete: true })` asserts a complete snapshot from a trusted transport
and verifies that the supplied findings match every unfiltered snapshot finding
before any write. A mismatch refuses with `snapshot_incomplete` and a remedy.
The GitHub CLI import uses its existing fully paginated, stable-head transport to
make this assertion. Default, filtered and single-provider SDK imports upsert
observations without inferring withdrawal; receipts expose `withdrawal_checked`.
Only a verified complete snapshot marks absent sources `review_withdrawn=true`.

Withdrawal retains source text, local reasoning, canonical disposition and group.
Reappearance clears it; changes remain in native PM history. Node-derived ids
prevent duplicate observations. Import receipts name each observation's effective
canonical id and verdict and count newly withdrawn sources separately.

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
exit status 1. Codes cover missing findings, invalid pairs, stale revisions, missing reasoning
and conflicting dispositions. Invalid confirmation records are nonfatal typed
`issues`; missing verdict targets and incomplete snapshot assertions use native
expected SDK errors with stable codes and `nextSteps` remedies.

The feature uses complete backend-neutral SDK reads, core similarity scoring,
idempotent attributed comments and ordinary audited item mutations. It requires
neither git nor provider credentials after import. Concurrent confirmations append
independent edges rather than replacing a shared membership field; a fresh read
computes the canonical representative. As with ordinary PM writes, re-read after
concurrent changes before making another decision. The proposal hash is a snapshot
binding, not an exclusive reservation of both source items.
