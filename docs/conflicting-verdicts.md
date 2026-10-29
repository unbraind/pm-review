# Conflicting verdict witnesses

`reviewConflicts(client, input)` and `pm review conflicts ITEM --revision REVISION`
read confirmed finding identity through the existing lineage graph. They compare
raw source judgments, including ones hidden by the canonical lineage projection.
Only an explicit `fix` and an explicit `refuse` constitute opposition. A local
judgment needs a nonblank reason; legacy decisions without `review_verdict_source`
remain eligible, while import-derived dispositions do not. `pending`, `duplicate`,
`stale`, and `informational` do not imply rejection.

```ts
import { reviewConflicts, serializeConflictWitness } from 'pm-review';

const packet = await reviewConflicts(client, {
  schema: 'review-conflicts/v1',
  item: 'sample-finding',
  revision: 'document-v3',
});
console.log(serializeConflictWitness(packet, 'toon'));
```

The input has exactly those three keys. Item selectors contain 1–512 characters
and use the SDK's normal item lookup, including shorthand. Revision selectors
contain 1–2048 characters and match opaque native `review_head` values exactly.
JSON whitespace and CRLF transport syntax are supported. Similar text, related
dependencies and unconfirmed lineage proposals never establish shared identity.

Scope is GitHub repository/PR/revision, or envelope origin/subject/revision.
Confirmed lineage can span revisions; different scopes are explicitly skipped.
Provider-specific artifact ids do not override the envelope's target subject.
The packet's `revision` digest binds the scope, every native source value and its
verified durable history version. It changes across A-B-A updates. It is an
observation address for downstream decisions, not an idempotent write key.

Successful packets have `state=conflict`, `no_opposition_observed`, or
`insufficient_evidence`. None means resolved or approved. The packet retains every
eligible judgment's native item id, durable version, source node, reviewer, URL,
reason excerpt, commit and withdrawal flag. Withdrawal never erases an opposed
judgment. Unverifiable history or malformed source identities skip that record
alone and make an otherwise unopposed packet insufficient. Malformed/dangling
lineage edges remain counted as missing evidence. Source availability is only a
local observation; the command makes no provider calls.

`missing` names the required attributed core Plan decision, evidence addressing
both incompatible arguments, and independent availability checks. Provider
multiplicity, recency, workflow completion and withdrawn/unavailable reviews
cannot supply that evidence. Core `planDecision` remains the persistence authority;
the web decision inbox remains the human request/response workflow. This package
does not write a parallel resolution record or infer that a core decision exists.

One lineage supports at most 32 observations. Reasons are excerpted to 240
Unicode code points with omitted UTF-8 byte counts. Source identities are retained
in full: item ids up to 512 characters, nodes 2048, providers/reviewers 256,
URLs 4096 and commits 2048. Persisted nonblank reasoning remains eligible at any
length supported by the native tracker; display limits never turn an explicit
judgment into absent opposition. Excerpting visits at most 241 code points and
reports exact omitted UTF-8 bytes without constructing a full code-point array.
Oversized identities are
unavailable evidence. Both compact JSON and SDK TOON output are checked against a
65,536-byte cap. Every emitted number is a nonnegative safe integer: durable
versions are verified by the SDK snapshot reader, and counts/omissions are checked
before success. Oversized output refuses instead of silently dropping a witness.

Refusals include `input_invalid`, `finding_unavailable`, `scope_unavailable`,
`lineage_too_large`, `state_changed`, and `output_invalid`, each with a fixed remedy.
The CLI exits 1 on refusal and 0 for a successful packet, including a conflict.
Use `state` to branch; process success does not mean review approval.

Without git, the SDK and command work in ordinary initialized trackers. They do
not invoke git, execute tests, fetch reviews, acquire claims or leases, mutate
native state, or create a shared outbox/journal. Repeated observations detect
changed membership, source state and durable revisions; `consistency=observed`
does not promise an atomic backend snapshot. Status labels and registry roles
never resolve an epistemic disagreement, so no lifecycle filter is applied.
