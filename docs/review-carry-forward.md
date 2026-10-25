# Carry review attention across revisions

`review scope` records an explicit declaration of attention at a durable history
version. `review carry-forward` compares that portable receipt with the current
tracker artifact. Both operations are read-only and work without Git, provider
credentials, network access, or a background worker.

The artifact is a native SDK item, including its body. Select exact native field
names, such as `description`, `body`, `dependencies`, `tests`, or an extension's
registered evidence-state field. A linked file's path does **not** attest to its
external bytes. Use core version facts or pm-evidence citations to maintain that
evidence in the tracker before declaring its scope. This feature does not resolve
external files or substitute for citation verification.

Create `selection.json` after explicitly reviewing the selected version:

```json
{
  "version": 1,
  "author": "review-agent",
  "reason": "Explicit review of the validation and relationship boundaries",
  "obligations": [
    {
      "criterion": "AC1",
      "fields": ["description", "body"],
      "evidence": [{ "id": "sample-evidence", "version": 1 }],
      "judgment": "reviewed"
    },
    {
      "criterion": "AC2",
      "fields": ["dependencies"],
      "evidence": [],
      "judgment": "reviewed"
    }
  ]
}
```

```sh
pm review scope sample-task --file selection.json --json > baseline.json
# After the artifact changes:
pm review carry-forward sample-task --file baseline.json
pm review carry-forward sample-task --file baseline.json --json
```

Read the version with core's history command. Versions are positive durable history
coordinates, not a content hash or an idempotency key. A receipt contains that
version, author, reason, complete artifact digest, and per-obligation criterion,
field, and complete evidence digests. Receipts contain no source bodies. Declaring
`reviewed` is the caller's assessment; authorship is attribution, not a signature or
automatic verification that a reviewer examined the content.

Criteria use the same ordered `AC1`, `AC2`, … selectors as coverage and closeout.
Semicolons and newlines delimit criteria; list padding is ignored. Each criterion
is hashed independently, allowing an unrelated criterion edit to preserve other
obligations. Reordering or inserting criteria conservatively stales shifted
identifiers. Omitted criteria and explicit `gap` judgments are `never_reviewed`.
Removed, previously assessed identifiers are reported as `removed` and never
count as retained attention.

Each reviewed obligation is `unchanged` only if its criterion and **every** selected
field match. Changing any selected field makes it `stale`. Arrays retain order,
relationships retain all SDK-provided attributes, and field values retain the
SDK's whitespace and CRLF semantics. Object key order alone is immaterial. A
missing selected field stales its obligation. Evidence is bound in full, including
native collections and provenance: any successor evidence revision invalidates
its judgment, including an import restoring old bytes and timestamps. A source
that cannot be read or whose current revision cannot be established fails closed
as stale. Evidence does not need to be a GitHub ReviewFinding: provider-neutral
records and native citation-state items work too.

Comparison reconstructs the receipt through the core SDK before trusting any of
its digests. Wrong-target, edited, malformed, or unavailable history never becomes
retained attention. Existing coverage comments cannot be upgraded automatically:
they do not declare an artifact-field scope. Lineage can establish finding identity
but cannot establish that a changed source was reviewed.

```ts
import { PmClient } from '@unbrained/pm-cli/sdk';
import { captureReviewScope, carryForwardReview } from 'pm-review';
import type { ScopeSelection } from 'pm-review';

const client = new PmClient({ author: 'review-agent' });
const selection: ScopeSelection = {
  version: 1,
  author: 'review-agent',
  reason: 'Explicit review of the validation boundary',
  obligations: [{
    criterion: 'AC1', fields: ['description'], evidence: [], judgment: 'reviewed',
  }],
};
const baseline = await captureReviewScope(client, 'sample-task', selection);
if (baseline.ok) {
  const report = await carryForwardReview(client, 'sample-task', baseline);
  if (report.ok) console.log(report.counts, report.approval); // always unverified
  else console.error(report.refusal.code, report.refusal.remedy);
}
```

Reports return four counts and small rows with criterion, state, and changed-field
or evidence identifiers. TOON is the host default; `--json` provides machine data.
No source excerpts or full item documents are echoed. The host retains its normal
output-budget controls. Inputs are regular UTF-8 JSON files limited to 1 MiB.
Selections allow at most 32 distinct obligations, 16 distinct fields per obligation,
and 16 distinct evidence items per obligation; reasons are 12–1000 characters and
author literals are 1–200 characters. A receipt is transport data; no tracker import,
export, sync, promotion, checkpoint, outbox, or package-owned state is created.

Refusals have `ok: false` and `refusal: { code, remedy }`; the CLI also exits 1.
Codes are `scope_invalid`, `scope_unavailable`, `history_unavailable`,
`criterion_unknown`, `field_unknown`, `baseline_changed`, and `state_changed`.
Malformed or foreign scope schemas are refused as one input; unselected tracker
records and foreign comments are skipped because they are outside the explicit
scope. No history is repaired or rewritten.

Reads use two observation passes and refuse detectable changes with
`state_changed`. They neither acquire a writer lease nor modify peer state.
`consistency: observed` means the report describes the values observed during
those reads, not an atomic multi-item transaction or a reservation against a later
edit. Re-read after concurrent work. Even unchanged obligations and an unchanged
artifact return `approval: unverified`. Fresh exact-artifact approval, closeout,
quantitative assurance and round completion remain independent gates.
