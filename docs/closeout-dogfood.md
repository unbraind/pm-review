# Closeout demonstrations

The current SDK verifier reviewed three public fleet PR items at their exact merge commits in
separate disposable copies. The original acceptance criteria, tests, links and
comments were retained, with no new mappings or relaxed gates. Each comparison
used the merge commit's first parent as `--base`. Tracked state before and after
was identical; original checkouts and trackers were untouched.

| PR | Item | Merge | Verdict | Evidence gap |
| --- | --- | --- | --- | --- |
| [pm-review #16](https://github.com/unbraind/pm-review/pull/16) | `pm-review-round-exit-contract` | `51cd1993858e` | 2 unproven, `ok=false` | Linked packed-install test exceeded the explicit 120-second total budget; changed source invocation unverified; neither prose criterion has a named-test binding. |
| [pm-review #15](https://github.com/unbraind/pm-review/pull/15) | `pm-review-f82w` | `b52892766d9e` | 2 unproven, `ok=false` | Item contains no linked tests and no executable criterion binding. |
| [pm-review #12](https://github.com/unbraind/pm-review/pull/12) | `pm-review-respond` | `49ab278dc12f` | 16 unproven, `ok=false` | Original links include HTTP tests and full npm/Bun release gates; the combined run exceeded the explicit 120-second budget. Source invocation unverified and prose criteria have no named-test bindings. |

These are current evidence verdicts under the stated budget, not findings that
the merged implementations are incorrect. A merged PR, historical successful
gates and old completion comments do not replace a completed independent run.
The command refuses to invent evidence for broad prose. Re-run with sufficient
budget and explicit mappings to review those criteria.

The seeded gamed change in `test/closeout.test.ts` changes a function's result
but gives its corresponding named test an empty body. The command observes the
green named test yet returns exit 1 with `source_unexecuted` and
`revert_survived`. Additional seeds cover lowered JSON and executable-config
coverage floors, disabled lint rules, focused/skipped tests and deleted test
cases/artifacts. A valid plain-tracker seed proves its criterion, then fails
the same named assertion when only the source is restored, producing a
`sensitive` revert-check receipt.

Behavioral regression proofs use separate copies of the package sources and
keep tests unchanged. Returning no findings from only `detectGaming` makes the
mixed-policy/test-gaming regression fail with an assertion error. Disabling only
`checkInvocation` makes the real-tracker vacuous-test regression fail because
`source_unexecuted` is missing. Each fails with exit 1, and original source
bytes remain untouched. These are disabled-behavior proofs for newly introduced
functions, rather than import/build failures from deleting new modules.

The final validation candidate passes both Node 22 and Node 26 CI jobs, each with
155/155 outer source tests, zero skipped tests, 100% statements/branches/functions/
lines across all 26 authored sources, and zero duplication. Packed npm/npx and
native Bun/bunx acceptance passes 1/1 in each matrix job. The Node 26 job also
runs the full `bun run release:check` with Bun 1.4.3: 155/155 source tests and
1/1 packed acceptance. [CI receipt](https://github.com/unbraind/pm-review/actions/runs/39642397454).

Additional behavioral proofs cover installed SDK peer links and Bun cache
symlinks. Managed extension dependencies remain available; package-manager
caches never enter the copied workspace. External artifact symlinks stay
refused. Each corresponding regression fails before its fix. A nested-intake
regression also proves that fixture provenance must describe its own workspace;
production trust refusal remains intact.

Earlier failed runs are retained in the tracker, including a corrected mistaken
PM-run receipt and the classifier timing failure tracked separately in
`pm-review-classifier-timing`. They are not passing gate evidence. Project policy
disables durable test-run recording, so verified PM runner results are retained
in comments without changing that policy.

The isolated-HOME Node 24 gate on the same candidate exited 1 with 154/155
source tests passing and zero skipped. Its only failure was the existing
severity-parser child reaching the unchanged 5000 ms deadline under shared-host
load; coverage still measured 100% in all four dimensions. The same isolated
parser test passed 1/1 on installed Node 26 at the original limit. This failed
full run is retained as non-passing evidence.

The complete isolated-HOME Node 26 retry then exited 0: 155/155 source tests,
zero skipped, all 26 authored sources at 100% in every coverage dimension,
zero duplication, and packed npm/npx plus native Bun/bunx acceptance 1/1.
The PM-linked run independently exited 0 with both command receipts passed
(21 integration tests and 5 evidence-boundary tests). No failed or incomplete
run is included in those passing counts. Code and tests were unchanged at
`ca837cc`; only documentation and tracker receipts follow that candidate.
