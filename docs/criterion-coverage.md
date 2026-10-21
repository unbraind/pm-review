# Criterion review coverage

The authoritative declaration is the target item's `acceptance_criteria`, split at
semicolons and newlines just like closeout. Risk criteria belong in that declaration;
this package does not create a competing assurance language. Core assurance continues
to own quantitative contracts, assertions and lifecycle enforcement.

Read with `pm review coverage <item> [--json]`. The result includes a SHA-256 revision
of the complete, exact declaration, ordered `AC1`, `AC2`, ... criteria, and counts of
reviewed and unreviewed criteria. Gap criteria count as unreviewed. Even whitespace
changes invalidate old mappings. Returning to the identical declaration restores
its content revision; this is content binding, not a monotonic edit counter.

Record a judgment with `pm review cover <item> --revision HASH --criterion AC1
--evidence FINDING --excerpt 'Exact review text of at least 24 characters'
--judgment reviewed --reason 'Why this review addresses this criterion'`.
Use `gap` to explicitly record missing review attention. An agent must make the
semantic judgment; shared words, passing checks, approval and lack of findings
never infer coverage. A quote must match the imported source description exactly,
contain 24 to 1000 characters after trimming, and the reason must contain 12 to
1000 characters after trimming. Both have a raw length ceiling of 1000 characters.

```ts
import { PmClient } from '@unbrained/pm-cli/sdk';
import { reviewCoverage, coverCriterion } from 'pm-review';
import type { CoverageResult } from 'pm-review';

const client = new PmClient({ author: 'review-agent' });
const map: CoverageResult = await reviewCoverage(client, 'sample-task');
if (map.ok) {
  const result = await coverCriterion(client, 'sample-task', {
    revision: map.revision,
    criterion: 'AC1',
    evidence: 'imported-finding-id',
    excerpt: 'Validate the input before writing.',
    judgment: 'reviewed',
    reason: 'Reviews the invalid input boundary',
  });
  if (!result.ok) console.error(result.refusal.code, result.refusal.remedy);
}
```

Evidence must be a `ReviewFinding` with substantive text, node identity, reviewer,
repository/PR coordinates, matching GitHub source URL and known commit. Import it
with `review import` first. Quota, skipped, failed, unavailable and similar service
notices contribute zero, even when they contain severity markers. Informational
summaries and empty approvals are conservatively ineligible. Mixed notice/review
bodies are also refused; select a separate substantive inline finding. Unknown-head
issue comments cannot establish coverage. Human judgments remain judgments, and
PM authors are attribution rather than cryptographic identity verification.

Writes append a versioned JSON comment through the SDK with PM author, timestamp
and normal history. They never close items or alter the criterion declaration.
Reads revalidate every record against the complete contract and source digest
(description, node, repository, PR, reviewer, URL, commit and kind). Content or
provenance drift invalidates a record. Changing a local fix/refuse verdict alone
does not rewrite what the review discussed. The map shows current source coordinates;
a refused record's original digest and excerpt remain in its comment/history.
Comment numbers are current one-based positions; the SDK permits comment editing
and deletion, so these are navigation selectors rather than permanent record ids.

For each criterion/source pair the last valid judgment wins; a later `gap` retracts
an earlier `reviewed` claim. Any current gap dominates other sources' attention.
Malformed, unattributed or stale mappings stay visible with a typed refusal and
contribute nothing. There is no inference from arbitrary comments or green bot
checks. The coverage command exits zero for a successfully read map even if every
criterion is unreviewed. Contract/write refusals exit one. Missing targets and
backend failures retain SDK/host errors. `ok` means the operation succeeded, not that
review is complete. The report omits full source bodies and quotes; host output
budget/omission controls apply for large trackers.

| Code | Remedy |
| --- | --- |
| `criteria_missing` | Declare acceptance/risk criteria on the item. |
| `criterion_unknown` | Select an AC identifier from the current map. |
| `criteria_changed` | Reassess against the new contract revision. |
| `evidence_missing` | Import and select an existing finding. |
| `evidence_ineligible` | Select substantive evidence with complete provenance. |
| `evidence_changed` | Reassess the changed review and append a mapping. |
| `judgment_invalid` | Supply an explicit judgment, exact quote and meaningful reason. |
| `mapping_invalid` | Append a valid record while preserving the invalid record for audit. |

## Without git

Both SDK operations and CLI commands work in plain trackers, including a PATH
without git and an explicit discovery ceiling. They run no git subprocess and
perform no GitHub/provider calls. They use the configured PM backend through the
SDK; backend access still follows its own transport and permission rules. Reading
a map does not write to its items. Importing new GitHub evidence needs GitHub access.
Exact-head freshness, required reviewers, tests and assurance must be checked with
their own gates: coverage does not assert the current code was reviewed.
