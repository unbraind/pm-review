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
