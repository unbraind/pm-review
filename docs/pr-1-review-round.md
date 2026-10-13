# PR 1 review fix round

All five findings posted after the requested review cutoff were read in full and accepted as `fix` decisions. No GitHub replies, reactions, resolutions or review requests were sent.

| Finding | Tracker owner | Regression | Function-only revert result |
| --- | --- | --- | --- |
| Repository-only precedent search | pm-review-precedents | repository-only precedent filters | Fails on missing PR coordinates |
| Bold severity before notice phrases | pm-review-import | bold severity badges | Fails: actionable completion quote becomes informational |
| Provider limit and setup notices | pm-review-pr7r | provider limit and setup notices | Fails: real notice shapes remain actionable |
| Automatic verdict reclassification | pm-review-import | re-import reclassifies automatic verdicts | Fails: informational source remains informational after becoming actionable |
| Duplicate and stale apply votes | pm-review-verdict | duplicate and stale first apply | Fails: first apply records no vote |

The regressions are in `test/review-regressions.test.ts`. They use real temporary PM trackers and synthetic remote mutations. Notice text covers the current PR's Sourcery size-limit, CodeRabbit star/file-cap and Code Scanning setup notices, plus supplied provider budget/access and Greptile trial-ended formats. Public actor mentions in fixtures use a synthetic identity.

`review_verdict_source` records `import` or `local`. Import refreshes automatically assigned classifications in both directions. Explicit local decisions retain their verdict, reason, commit and audit comments. Legacy reason/commit metadata and final actionable verdicts establish a local decision; legacy undecided informational records are refreshed.

The packed-consumer dogfood used a temporary copy of the target tracker, the pinned PM host, and an installed package tarball. Commands:

```sh
npm run build
npm pack --ignore-scripts
pm review import --repo unbraind/pm-review --pr 1 --author codex-agent --json
pm review round --repo unbraind/pm-review --pr 1 --author codex-agent --json
pm review verdict <finding-id> fix --repo unbraind/pm-review --pr 1 --author codex-agent --reason '<verified reasoning>' --json
```

The initial import created 12 records and updated 22. The round returned exit 1 with exactly five unresolved threads and no unimported nodes; it also retained older pending records. The bold-badge finding was incorrectly informational, illustrating its own defect. All five local verdict receipts reported `applied`, `replied`, `reacted` and `resolved` as false.

Scratch finding identities:

- pm-review-gh-6af394c8207965426087ccb4: repository-only search
- pm-review-gh-6a162ade3a56d678338db87d: bold badges
- pm-review-gh-bbe335ca324917b453117829: notices
- pm-review-gh-a2d977ca4e6fb93921fe71b3: reclassification
- pm-review-gh-a5ff4741b15ab70580b3ccf3: votes

Dogfood UX observations: import receipts provide stable item/node ids but omit titles; round receipts expose ids requiring an additional item lookup for context. Isolated HOME needs an explicit token because the normal GitHub CLI login is unavailable. Passing `--author codex-agent` explicitly is needed at the extension boundary; setting only PM_AUTHOR produced the extension's default author on the initial scratch import. No tracked history was rewritten. `pm install` emitted a deprecation hint for `pm package install`.

The fixed tarball re-import created zero records and updated all 34. All five explicit `fix` verdicts survived with source `local`. The legacy major completion-quote finding returned to `pending` with source `import`; Sourcery's size-limit and Code Scanning setup records became `informational` with source `import`. Repository-only precedent search exited zero and returned nine matches for the dogfood query. The live round still exited 1 with five unresolved threads, nine unvoted contributions, thirteen pending records and no unimported nodes. These are snapshot results before publishing the fix commit, not final-head review approval.

Both release gates passed under fresh HOME with GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1: `npm run release:check` and `bun run release:check`. Each passed 91/91 tests with zero skipped/cancelled tests, 100% statements, branches, functions and lines across 17 sources, zero duplication, docstrings, production audit, packing, changelog and provenance checks, plus the separate packed npm/native Bun consumer acceptance test. The standalone identity gate reported zero violations; the added-line privacy check also reported zero.
