# Carry-forward validation

Public source: [pm-review main snapshot
24e04fc](https://github.com/unbraind/pm-review/commit/24e04fc).
The tracker was exported with `git archive` into a plain directory. Its complete
source tree was made read-only before running `test/scope-public-tracker.ts` with
a Git discovery ceiling. The script uses only SDK reads and explicit test
declarations of attention; it does not assert that a real reviewer approved these
items. It hashes the original file names and bytes before and after all calls.

| Measurement | Result |
| --- | ---: |
| Public items inspected | 54 |
| Durable history versions inspected | 733 |
| Artifacts compared from version 1 | 23 |
| Artifacts changed since version 1 | 23 |
| Unchanged reviewed obligations | 21 |
| Stale reviewed obligations | 2 |
| Never-reviewed current obligations | 93 |
| Removed reviewed obligations | 0 |
| JSON/CRLF receipt replays | 23 |
| Items without AC1 at version 1 (`criterion_unknown`) | 31 |
| Source files byte-identical after reads | 114 |
| Largest compact report, JSON bytes | 1,209 |
| Exact-artifact approvals produced | 0 |

Reproduce by exporting the same public commit and invoking:

```sh
node test/scope-public-tracker.ts "$EXPORTED_TRACKER_ROOT"
```

Targeted tests cover individual criterion edits, unrelated artifact edits,
selected-field changes, evidence successor revisions, missing artifacts, malformed
and wrong-target receipts, bounded UTF-8 input, empty/gap scopes, native relationship
fields, and a PATH without Git. `test/scope-interleaving.test.ts` uses two real SDK
clients on one plain tracker. It injects a peer transition before and after every
SDK read, plus the endpoint, in capture and comparison; it preserves all peer
writes and foreign comments. Values always come from the real SDK, with an
instrumentation proxy solely scheduling transitions.

`test/scope-model.test.ts` runs 500 deterministic random operation sequences with
seed `1371598885`: 2,988 operations, 1,988 comparisons, and 75 native SDK fields. It seeds native scalar, collection, scheduling, plan, linked-test,
body and relationship fields through the core SDK. The reference model compares
SDK-native values by structural equality and tracks evidence version identity.
It replays old native evidence inputs and old scope receipts, varies JSON padding
and CRLF transport, and reads back native items, relationships and immutable
history after every comparison. The package has no native item importer/exporter
or sync state: scope transport is read-only. No hand-written native normalization
or SDK state mock is involved.

Behavioral revert: replacing only the comparison's per-obligation retention with
whole-artifact invalidation makes the named unrelated-edit test fail: it returns
zero unchanged and two stale obligations instead of two unchanged and zero stale.
The original comparison was restored before verification.

Packed npm/npx and native Bun/bunx consumers run the new commands through real
host rendering, JSON transport, process exits and TOON comparison. Full fleet
release evidence comes from CI, including the unchanged 100/100/100/100 coverage
thresholds and native Bun release gates; exact run links and counts are recorded
in the PR.

The pinned SDK has a separately reproduced existing-item import/history defect:
importing a description update on a Task with a relationship can yield
`history_replay_invalid: verify_failed:before_hash_mismatch:entry_2`.
[The follow-up tracker item](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-sdk-import-history-gap.toon)
records the minimal reproduction. Scope capture refuses corrupt history and never
repairs it. New-item imports used to seed the model remain replayable.
