# Carry-forward validation

Public source: [pm-review main snapshot
46ed26c](https://github.com/unbraind/pm-review/commit/46ed26c).
The tracker was exported with `git archive` into a plain directory. Its complete
source tree was made read-only before running `test/scope-public-tracker.ts` with
a Git discovery ceiling. The script uses only SDK reads and explicit test
declarations of attention; it does not assert that a real reviewer approved these
items. It hashes the original file names and bytes before and after all calls.

| Measurement | Result |
| --- | ---: |
| Public items inspected | 64 |
| Durable history versions inspected | 941 |
| Artifacts compared from version 1 | 31 |
| Artifacts changed since version 1 | 31 |
| Unchanged reviewed obligations | 29 |
| Stale reviewed obligations | 2 |
| Never-reviewed current obligations | 111 |
| Removed reviewed obligations | 0 |
| JSON/CRLF receipt replays | 31 |
| Items without AC1 at version 1 (`criterion_unknown`) | 33 |
| Source files byte-identical after reads | 134 |
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

Revision-boundary hardening repeats the overlap audit: PR 42 already delivered
the feature; coverage and lineage remain separate, core verified `get(at)` is
the revision oracle, and pm-evidence owns citation resolution. The new issue
[scope boundary revalidation](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-scope-boundary-revalidation.toon)
tracks strict shared schema validation and the second monotonic evidence probe.

The comparison now exercises 17 read boundaries for each artifact and evidence
(34 competing-transition cases), plus five capture boundaries. A separate ABA
regression updates evidence and imports its earlier native document after the
first history probe. SDK-read values are structurally equal after
the replay, history advances from one to three entries, and comparison refuses
`state_changed`. The next read correctly reports one stale dependent obligation.

The schema corpus refuses sparse arrays, unsafe versions, extra keys, oversized
strings and escaped JSON beyond the byte budget before any SDK read. It allows
an actual receipt emitted by the released v1 producer at the public main snapshot,
as well as released v1 receipt shapes and whitespace/CRLF transports. Another seeded fuzz
runs 600 numeric input trials and 30 producer/validator/transport round trips
under seeded ambient session focus;
all package operations leave SDK-read native artifact and evidence state intact.
The output boundary applies the same safe integer version domain and exact
nonnegative count domain before returning success, with extreme output-number
refusals tested independently. No floating-point threshold drives a verdict.

Two behavioral reverts in a disposable source copy each fail their regression:
restoring only the old scope validators accepts an extra-key declaration;
restoring the old comparison returns success after the byte-identical evidence
replay. The fixed sources are never changed for these reverts. Targeted tests
are rerun on the fixed implementation afterwards.

Packed acceptance now executes capture, JSON/TOON comparison and refusal exits
through both npm global and Bun global hosts in addition to the existing
project-local npx and native bunx paths. Neither SDK acquisition nor scope
comparison resolves the host from argv, a symlink or an executable lookup.

The final compatibility check preserves core-native field names longer than 200
characters. A real SDK field with 201 characters captures, validates and replays
without changing native state. The total JSON byte budget provides the bound;
arbitrary shorter field/identity caps would reject valid released v1 scopes.
Every captured receipt also passes the shared receipt schema before returning
success. Restoring only the 200-character field cap in a disposable copy fails
this regression 1/1; the fixed test then passes 1/1. Final targeted scope tests
pass 12/12 with all four scope coverage dimensions at 100%. Repeating the
read-only public snapshot measurement after this correction yields the same
numbers in the table above.

Full npm release gates on Node 22 and 26 passed at implementation `578a47c` in
[CI 40836988622](https://github.com/unbraind/pm-review/actions/runs/40836988622).
Node 22 measured 313 suite tests and three packed-install tests, with all four
coverage dimensions at 100% across 48 source files. Its native model measured
500 sequences, 2,988 operations, 1,988 comparisons and 75 native fields. The
Bun full gate was still running at the queue's 30-minute wait cutoff. The final
compatibility correction requires fresh exact-head CI; those earlier full-gate
results do not certify the corrected head. Duplicate local model and packed
runs stopped after the successful CI evidence are not counted as local passes.
