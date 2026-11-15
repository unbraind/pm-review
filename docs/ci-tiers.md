# Fleet CI v2

Required checks remain `test (22)`, `test (26)` and `codeql`.
PR CI uses GitHub-hosted Ubuntu, cancels superseded PR runs, and bounds each
matrix job to 25 minutes (expected execution: 6-10 minutes). Manual dispatch
always selects the code tier. There is no PR-tier push trigger.

| Check | Code PR: Node 22 | Code PR: Node 26 | Docs/tracker PR: both | Deep: Node 22 and 26 |
| --- | --- | --- | --- | --- |
| Dependency install / merge-driver preparation | npm ci | npm ci | npm ci | npm ci |
| Strict tracker health / required merge drivers | — | yes | yes | yes |
| Commit identity and private-path policy | — | npm gate | yes | npm + Bun gates |
| Build and test compilation | yes | npm gate | — | npm + Bun gates |
| Test suite | quick | quick via coverage | — | full, npm + Bun |
| Typecheck, lint, duplication, docstrings | — | npm gate | — | npm + Bun gates |
| Coverage: statements, branches, functions, lines at 100% | — | quick | — | full, npm + Bun |
| Production dependency audit | — | npm gate | — | npm + Bun gates |
| Pack dry-run | — | npm gate | — | npm + Bun gates |
| Changelog consistency | — | npm gate | yes | npm + Bun gates |
| Release publish attestation verification | — | npm gate | yes | npm + Bun gates |
| README publishing policy / tracker documentation links / historical evidence | via tests | via coverage | yes | npm + Bun gates |
| Packed npm/npx and Bun/bunx project/global acceptance | — | npm gate | — | npm + Bun gates |
| Bun package-graph install smoke | — | yes | — | yes |
| CodeQL (separate required job) | every PR | every PR | every PR | main pushes and weekly schedule |

Tracker/docs-only changes are `.agents/pm/**`, `*.md`, `docs/**`,
`CHANGELOG.md` and `LICENSE`; these run only dependency installation, strict
tracker health, identity checking, changelog checking, publish attestation and
focused README/tracker documentation checks in both required test jobs. Executable
`.mjs`, `.cjs`, `.js` and `.ts` tracker files select the code tier. Change detection
compares the PR base/head with NUL-delimited paths and rename folding disabled,
so a source deletion or source-to-docs move cannot escape the code tier.
CodeQL is required by branch protection, so it intentionally has no path filters.
It retains its Monday 01:47 UTC scan, PR cancellation and a 30-minute job timeout.

Deep checks use a Node 22/26 × npm/Bun matrix, distinct from required PR checks.
They run on main pushes, daily at 02:19 UTC, and dispatch, with per-ref
cancellation and a 120-minute timeout. This schedule avoids Daily Release at
03:23 UTC and its hourly :41 reconciliation. Each of the four jobs runs one full release gate, plus the Bun install smoke. This includes the original Node
22/npm, Node 26/npm and Node 26/Bun combinations and adds Node 22/Bun symmetry.
No original release-gate check is removed. There are no separate Windows or
lifecycle CI jobs in this package. Release and pm-github workflows are unchanged.

Deep routes to `[self-hosted, pm-local]` unless the fleet controller sets
`PM_LOCAL_DEEP=off`, which selects `ubuntu-latest`. Busy local runners queue;
this change does not modify that variable or branch protection. Hosted runners
use setup-node's npm cache and setup-bun. Local runners use persistent npm cache
and the Bun already on PATH; `bun --version` records the selected runtime.

`test/support/depth.ts` preserves full depth when unset, `full` or unrecognized.
Quick depth runs a deterministic prefix: the first 50 of each 500-case corpus
and first 60 of the 600-case numeric-boundary corpus. The floor is 25, capped by
the original count. Seed generation, per-case assertions, coverage source scope
and all four 100% coverage thresholds stay unchanged. Aggregate witness counts
scale with the corpus size; long-reason and native-field checks still run.
Ordinary local and release commands stay full unless callers select quick.

The classifier's former 50 ms elapsed bound could fail when a correct process
was descheduled. Its adversarial 100k-input cases now count regex scan work,
bounded by twelve times input length, and retain exact classification assertions.
The subprocess watchdog remains to catch a stalled regex; this operation bound
does not prove internal regex backtracking complexity or a latency SLA. Classifier
watchdogs and packed acceptance's existing operation deadlines scale through
`PM_TEST_TIME_SCALE` (default 1; deep 3), with fractional milliseconds rounded up and invalid/nonpositive or overflowing scales rejected before spawning.
Packed fixtures scrub inherited PM controls before binding their own tracker
coordinates, protecting against ambient `PM_PATH` and source-root redirection.

Packed acceptance already installs the tarball via npm and Bun into project
and global hosts, invokes npm/npx and `bunx --bun --no-install pm`, activates
commands and reads/writes real disposable trackers. It proves installed bunx
execution, rather than a separate ephemeral bunx download. Consequently the
Node 26 PR leg adds only `bun install --no-save`, not another full release gate.

Baseline evidence: successful main CI run 43680447531 (2026-11-15) took 42m 37s
for Node 26 and 41m 58s for Node 22, including queues of 17m 53s and 21m 14s.
Node 26's repeated full gates measured request sequences at 472.69-473.71s,
scope sequences at 177.92-180.77s and conflict sequences at 99.83-99.94s.
The owner measured 1,362 runner-minutes/day and about 44 minutes median successful
PR CI wall time for this repository. New quick timings are recorded in the PR
and package tracker; these are shared-capacity observations, not controlled
benchmarks. Full depth is certified by deep CI after merge, not rerun locally.

The Bun release command launches the same npm/Node test and coverage scripts.
It validates launcher compatibility; the packed acceptance consumers separately
exercise Bun installs and CLI execution. It does not certify the full suite
running on the Bun runtime.
