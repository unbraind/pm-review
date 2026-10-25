# Review SDK adoption evidence

The 2026-10-25 audit found two local implementations in coverage. Both are
replaced without changing the pinned SDK version.

| Audit finding | Replacement | Regression and revert proof |
| --- | --- | --- |
| `src/coverage.ts:76`: local semicolon/newline parser | SDK `splitAcceptanceCriteria`; closeout and scope share it | `SDK criteria preserve multiline wording...` fails when only `reviewCoverage`, `scopeCriteria`, or `reviewCloseout` is restored: three old criteria versus two SDK criteria |
| `src/coverage.ts:109`: complete corpus scan to find one evidence item | `PmClient.get(id, { full: true })`, native expected-error and NOT_FOUND classification | `direct SDK evidence lookup...` fails when only `coverCriterion` is restored: three complete corpus reads instead of two |

All five behavioral revert probes exit 1 on assertions; the candidate passes.
Restoring only `criterionEvidence` also fails the multiline migration regression:
a legacy AC2 comment incorrectly proves a newly regrouped criterion. Multiline
contracts now require `closeout-v2 AC2:` mappings; old comments remain stored but
cannot silently retarget. Single-line closeout mapping syntax stays unchanged.
`direct evidence read propagates storage failures...` also corrupts a real
scratch item between the corpus read and the direct evidence read, checking
that parse and filesystem errors cannot become missing-evidence refusals.

The intentional change is SDK criterion governance: semicolons delimit criteria;
newlines remain part of a criterion. Multiline coverage contracts receive a
`review-criteria/v2` revision hash and legacy bindings refuse `criteria_changed`.
Single-line contracts preserve identifiers and hashes. See
[the migration contract](criterion-coverage.md).

The replaced coverage paths bound current item content and retained certified
complete corpus receipts; neither verified history chains. Historical scope
continues using verified SDK reconstruction. The new
`cache-primed historical scope still detects subsequently corrupted native history`
regression primes current, complete-list, and historical reads, corrupts the
source history hash, and checks `history_unavailable` from both capture and
carry-forward, with no change to artifact history.

## Reproduce the differential

Build the baseline from `origin/main` (`d65d149bbcafdc11d2ef6addcfff8bf2e4f479e1`)
and retain its `dist` separately before building the candidate. Export public
trackers with `git archive <public-ref> .agents/pm` into plain scratch directories.
The worker resolves both builds against the same pinned SDK.

```sh
node test/sdk-adoption-public-tracker.ts <exported-pm-root> <baseline-dist> dist
```

The script makes exported durable files read-only, fingerprints them before and
after each build, and runs with no git in PATH and an explicit discovery ceiling.
It compares coverage, invalid-revision cover requests (no writes), scope criteria,
and a sample of three closeout reports or native refusal messages per tracker.
Closeout tests have a ten-second budget in a disposable workspace; these comparisons do not establish successful
closeout or fresh test execution. Multiline differences, if present, are checked
against SDK boundaries and listed explicitly. Synthetic multiline migration and
successful cover behavior have separate real-tracker regressions.

Recorded public exports:

| Tracker ref | Items | Function comparisons | Identical items | Durable files unchanged |
| --- | ---: | ---: | ---: | ---: |
| pm-review `d65d149bbcafdc11d2ef6addcfff8bf2e4f479e1` | 56 | 171 | 56 | 118 |
| pm-evidence `603e57d04e88ec4931ab5242d13c0dc3f6211514` | 10 | 33 | 10 | 26 |

All 204 comparisons pass with zero intentional differences in these exports.
Each tracker supplies two closeout reports and one identical native refusal;
other items compare coverage, refused cover requests, and scope criteria.
