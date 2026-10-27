# Evidence request validation

Public input: the committed `unbraind/pm-review` tracker at main commit
`74073af` (PR 44), exported into a scratch project outside Git. The source tracker
was never opened for mutation. The measurement command is
`node test/requests-public-tracker.ts <exported-tracker-root>` with an explicit
Git ceiling. The script fingerprints exported durable inputs and compares SDK
and CRLF file results.

| Measurement | Result |
| --- | ---: |
| Public items read through certified SDK listing | 57 |
| Selected finding/criterion obligations | 48 |
| Pending obligations | 5 |
| Emitted at a three-request budget | 3 |
| Exact omitted request keys | 2 |
| Terminal obligations explicitly skipped by registry roles | 43 |
| Satisfied without explicit arrivals | 0 |
| Complete compact JSON characters/bytes | 3,606 / 3,606 |
| Durable exported inputs unchanged | 120 |
| CRLF file result equals SDK result | yes |
| Git/provider calls or test execution required by feature | none |
| Approval | unverified |

Synthetic non-git acceptance separately seeds **30 unresolved findings**: a
seven-request budget emits 7 and names all 23 omissions in 6,378 JSON characters.
A 6,377-character budget emits 6 and names 24 omissions in 5,974 characters.
A zero-request budget accounts for all 30 omitted keys. A budget smaller than
the omission receipts returns `budget_too_small`.

The seeded model uses seed `0x10e71026` for 500 random operation sequences. It
seeds every native metadata family (including relationship attributes, nested
plans, test configuration, annotation provenance and CRLF body/description),
replays older packet and arrival versions, and compares state read back through
the SDK with a version/equality reference model. It never substitutes private
normalization rules. The package adds no native item import/export/sync writer;
its portable round trips carry selectors and receipts only.

The pinned SDK has an existing imported-update history limitation, tracked by
[`pm-review-sdk-import-history-gap`](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-sdk-import-history-gap.toon).
Replacing an existing linked-artifact item with a rich imported document can
yield `verify_failed:before_hash_mismatch:entry_2` and `history_replay_invalid`.
The request queue rejects unverifiable evidence and never repairs history. Model
seeding uses a fresh native imported document and subsequent SDK mutations.

Peer tests instrument every before/after SDK operation boundary in both finding
and criterion paths, including explicit arrivals. Each transition is performed by
a second real SDK client on the same non-git tracker: 198 boundary/baseline cases
and 192 injected peer transitions. Target revisions, evidence
revisions and status definitions are changed independently. Additional regression
cases invalidate a coverage source between obligation observations and mutate the
caller's packet after validation. The feature owns no shared mutable state.

Packed acceptance also checks the shipped SDK and real npm/npx and native Bun/bunx
commands: JSON/TOON queues, explicit arrivals, stale request keys and typed refusal exits.

Full release-gate counts and exact CI run links are recorded in the linked PR
after CI completes; thresholds remain unchanged at 100% for every coverage dimension
and zero duplication. Local checks are targeted to respect shared-host CPU load.
