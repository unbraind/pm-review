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

In four independent disposable source copies with the same tests/dependencies:

| Behavioral control removed | Retained test selector | Result |
| --- | --- | --- |
| Evidence eligibility predicate | `quota and skipped` | Exit 1, assertion failure |
| Complete-criterion revision guard | `changed criteria, reordered` | Exit 1, assertion failure |
| Author/date propagation | `explicit coverage is attributed` | Exit 1, assertion failure |
| Append explicit repeated assessments (restore global deduplication) | `explicit coverage is attributed` | Exit 1, assertion failure |

Each proof runs `node --test --test-name-pattern='<selector>' test/coverage.test.ts`.
The notice control forces the eligibility result true, the revision control removes
only its refusal guard, and the attribution control blanks only author/date. The fourth control restores
only global comment deduplication; it fails the retained retraction/replay test.
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
