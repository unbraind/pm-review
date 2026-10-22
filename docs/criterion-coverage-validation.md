# Criterion coverage validation

## Public tracker corpus

Read-only source: the public `unbraind/pm-review` tracker at
`68eea9cccf2a32c0f101cb85ce8b2f58369f600e` (`origin/main`). A Git archive of
`.agents/pm` was extracted into a plain temporary directory with no repository.
No source titles, review text or tracker configuration are reproduced here.
The SDK client disabled extensions; measurement ran with an empty PATH and an
explicit Git discovery ceiling. The copied source tracker was read, never mutated.

| Measurement | Result |
| --- | ---: |
| Complete item inventory | 45 |
| Imported ReviewFinding items | 22 |
| Items with declared criteria | 15 |
| Declared criteria | 79 |
| Explicit mappings | 0 |
| Reviewed criteria | 0 |
| Unreviewed criteria | 79 |
| Typed missing-contract refusals | 30 |
| Largest compact JSON map | 1,753 bytes |
| Sum of the 15 JSON maps | 9,678 bytes |

This is deliberately zero coverage despite a substantial imported review corpus:
no agent has made an explicit criterion judgment. Counts are measured rather than
inferred from reviewer checks. SHA-256 fingerprints of the copied tracker before
and after the measured read were identical. The first probe identified normal SDK
metadata caches and a context-usage runtime ledger; no public source file changed.
For the measured probe caches were primed, scratch context-usage recording disabled
and the entire tracker fingerprinted. No host or tracked configuration was changed.

## Regression evidence

`node --test test/coverage.test.ts` passes 9/9 through the pinned PM linked-test
runner, zero failures/skips. It exercises substantive attention, no inferred green
check coverage, zero notice coverage, content/provenance drift, malformed records,
typed remedies, explicit retractions/gaps, SDK attribution and no-git dispatch.
The host's test-result recording policy is disabled, so observed receipts are
recorded on the feature item rather than changing that policy.

In six independent disposable source copies with the same tests/dependencies:

| Behavioral control removed | Retained test selector | Result |
| --- | --- | --- |
| Evidence eligibility predicate | `quota and skipped` | Exit 1, assertion failure |
| Complete-criterion revision guard | `changed criteria, reordered` | Exit 1, assertion failure |
| Author/date propagation | `explicit coverage is attributed` | Exit 1, assertion failure |
| Append explicit repeated assessments (restore global deduplication) | `explicit coverage is attributed` | Exit 1, assertion failure |
| Explicit author forwarding | `a gap from another source` | Exit 1, assertion failure |
| Restore topic-wide quota/rate-limit denylist | `substantive quota and rate-limit` | Exit 1, assertion failure |

Each proof runs `node --test --test-name-pattern='<selector>' test/coverage.test.ts`.
The notice control forces the eligibility result true, the revision control removes
only its refusal guard, and the attribution control blanks only author/date. The fourth control restores
only global comment deduplication; it fails the retained retraction/replay test.
The fifth removes only the author override passed to the PM comment mutation.
The sixth restores only the topic-wide notice denylist and fails the substantive
quota/rate-limit regression. The final targeted suite passes 10/10 with 100% statements, branches, functions
and lines across both new modules, adding the SDK and registered-command
regression to the original nine tests.
The production source and tracker remain unchanged during these probes.

Local `npm run typecheck`, `npm run build:test`, `npm run build`, `npm run lint`,
`npm run docstring` and `npm run duplication` pass. The extension activation
regression passes 1/1 and confirms eleven registered commands. The two new authored
modules are included in the unchanged 100/100/100/100 coverage inventory. The full
npm and Bun release checks, including packed npm/npx and native Bun/bunx CLI
coverage reads, writes and refusal exits, are delegated to CI because of host load.
The PR records the exact CI run and measured counts; local targeted checks do not
claim a full release-gate result.

Risk and boundary: these are attributable judgments of review attention, never
assurance proof or exact-head reviewer completion. Coverage cannot prove that the
judgment's semantic interpretation is correct. Full contract content revisions may
be reused when the exact declaration is restored. See the contract document for
source eligibility, immutable digest bindings and comment-edit limitations.


Packed-consumer integration identified two pinned-host boundaries: generated
`--review-pr`/`--review-url` aliases are classified as typos before extension field
handling, so the fixture uses canonical `--field name=value`; and the injected
SDK client defaults to `pm-extension`, so coverage forwards explicit caller
attribution to the mutation. These are recorded without filing upstream issues.
The first two CI runs fail at fixture setup and are not full-gate evidence.


Reviewer feedback on the existing classification issue #14 is addressed on this
feature path: substantive severity-marked findings about allowance, quota and
rate-limit counters remain eligible. The guard rejects service-notice phrases,
not topic words. Real SDK and registered-command regressions retain rejection
of quota-exhausted, skipped, unavailable and rate-limit-reached notices. The
existing round-classifier issue remains open; this change does not certify it.


The local `npm run test:install` targeted acceptance run passes 1/1, including
packed npm/npx and native Bun/bunx consumers. It verifies both coverage commands,
caller attribution, TOON/JSON reads and typed refusal exits. It is targeted
installation evidence, not a locally executed full release gate.

## Full CI receipt

Source head `e8f102d7a1e459e7d89d11a253b3c6fc77cceae4` passes the complete
[CI run](https://github.com/unbraind/pm-review/actions/runs/39687725734).
The npm release-gate steps on Node 22 and Node 26, and the full
`bun run release:check` on Node 26, each pass 175/175 outer source tests with zero
failures/skips. Each reports all 28 authored source files at 100% statements,
branches, functions and lines. The packed npm/npx and native Bun/bunx acceptance
passes 1/1 in each npm job and again inside the Bun gate.

Duplication is 0% (0/6,461 lines, 43 sources, zero clone pairs); all 90 declarations
across 28 files are documented. Fresh-clone tracker health/history, identity/privacy,
typecheck, lint, production audit, packaging, changelog and attestation checks pass.
Nested deliberate failure fixtures in tooling tests are negative controls; the
outer source-suite result is the 175/175 receipt. No thresholds, dependency pins,
release workflow or telemetry settings changed. The final receipt/claim-release
commit changes only documentation and PM records; its CI is reported in the PR.

## Squash-stack reconciliation

PR #27 was merged with main `260d41c` after #25 was squash-merged. Conflict
resolution retains #27's coverage commands, exports, README and consumer checks.
Twelve shared closeout, fixture and toolchain files match main exactly; ten
coverage source, test and documentation files matched the original PR head before
this receipt. The changelog is regenerated, and no `dist/` files are tracked.

The current `node --test test/coverage.test.ts` run passes 10/10 with no failures
or skips. The activation selector
`node --test --test-name-pattern='extension activation exposes all commands' test/core.test.ts`
passes 1/1. In a disposable source copy, restoring only `registerReviewCommands`
to main's implementation fails that retained activation test with
`AssertionError: 9 !== 11`, exit 1. An earlier probe selected the independent schema
test and passed; it is not negative-control evidence. The corrected selector
verifies that dropping coverage registration during conflict resolution is caught.

The first local isolated full npm gate passed 175/175 source tests and all coverage
thresholds, then failed installed closeout acceptance: the outer PM linked-test
host's `PM_SOURCE_WORKSPACE_ROOT` leaked into the consumer environment. The fixture
now binds that coordinate to the command's own workspace, and deliberately sets
an outer package root in the retained regression. Shared closeout source remains
identical to main. This was a fixture defect, rather than a timeout.

A disposable copy restoring only `consumerEnv` to its pre-fix implementation,
while retaining the outer-root regression and production code, runs
`node --test --test-reporter=spec test/install.acceptance.ts` and fails with an
`AssertionError`, `artifact_missing` and `proof.md` in the installed closeout
result, exit 1. The fixed baseline and final full gates are recorded separately
on the feature item and PR; failed controls are not release-gate approvals.

### Local full-gate receipt, 2026-10-22

Source commit `9989ba3` passes the complete isolated npm and Bun release checks:

- `env HOME=$(mktemp -d) GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm run release:check`
- `bun run release:check`

Each passes all 12 stages, 175/175 outer source tests and 1/1 packed npm/npx plus
native Bun/bunx acceptance, with zero failures, skips or cancellations. The fixed
PM-linked `npm run test:install` baseline also passes 1/1 with the deliberately
inherited outer source root. The first npm attempt's fixture failure is retained
above; no timeout caused it, and the corrected complete retry passes.

Across 28 authored source files, statements/lines are 2,653/2,653, functions
149/149 and branches 1,371/1,371: 100% in all dimensions at unchanged thresholds.
Duplication is zero across 6,465 lines and 43 sources; all 90 declarations are
documented. Production audit reports zero vulnerabilities; the 73-file package
allowlist, changelog and publish-attestation checks pass. Nothing was published.

## Review round: notice clauses versus substantive findings

Thread `PRRT_kwDOVGABD86vPQ3P` exposed substring-based refusals for substantive
findings discussing quota-exceeded errors, rate-limit handling, missing access
checks or failed generation. The coverage predicate now recognizes complete
notice clauses at line starts, allowing Markdown and severity prefixes. Every
previous notice alternative follows the same boundaries, including LF/CRLF line
ends and notice clauses within mixed review bodies. The contract document records
these distinctions. The existing shared round-classifier issue remains separate.

The retained classification regression exercises 56 real non-git scenarios through
both SDK and registered commands: 28 substantive findings are eligible and 28
notices are refused. Its PM-linked run passes 1/1; the complete coverage suite
passes 10/10 with zero failures/skips. Before correction the new cases fail with
an assertion on the substantive quota-exceeded error finding.

A disposable copy retaining the expanded tests restores only `eligible` from
`ddce5e9`. Running
`node --test --test-name-pattern='substantive quota and rate-limit' test/coverage.test.ts`
fails with that same `AssertionError`, exit 1. No other function is reverted and
the source worktree remains unchanged. Final full-gate results follow separately.

Self-review also checked severity formats already recognized by the package.
An italic-prefixed unavailable-review notice exposed a false acceptance in the
first anchored draft. Final coverage includes italic labels, plain `severity:`
labels and linked/unlinked priority badges. The final regression has 60 scenarios:
28 substantive findings accepted and 32 notices refused through both real SDK and
registered CLI operations. The PM-linked selector passes 1/1, and the complete
coverage suite passes 10/10 with zero failures/skips.

Two independent copies retaining these final cases restore only `eligible`:
`ddce5e9` fails on the substantive quota-exceeded finding, and `c67c05c` fails on
the italic unavailable-review notice. Both exit 1 with an `AssertionError`.
The first full verification attempt was intentionally stopped before completion
for this refinement; it is incomplete evidence and is not a release-gate pass.
