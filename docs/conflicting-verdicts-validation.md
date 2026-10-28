# Conflicting-verdict validation

Public input: `unbraind/pm-review`, `origin/main` at `06cd671`, exported with
`git archive` into a plain directory outside git. Native input files were made
read-only. The validation runner inventories those immutable native files rather
than writable derived SDK caches, so subsequent observations remain replayable.

| Measurement | Result |
| --- | ---: |
| Native items | 63 |
| ReviewFinding observations / lineage scopes | 22 / 22 |
| Successful packets | 17 |
| Explicit source judgments / non-explicit skips | 15 / 2 |
| Historical observations without a revision selector | 5 typed `input_invalid` refusals |
| Natural opposed judgments | 0 |
| Maximum compact JSON / TOON bytes | 1554 / 1447 |
| Matching CRLF query replays | 17 |
| Native input files with unchanged fingerprints | 132 |

The public corpus contains no natural opposition; synthetic real-tracker
regressions establish positive conflict behavior, including 13 fixes versus one
refusal and withdrawn/unavailable sources. Every packet keeps resolution
unverified.

Local commands and evidence:

- `node --test --test-concurrency=1 test/conflict-model.test.ts`: one property
  test passed; seed `3237023784`, 500 sequences, 995 operations, 96 native fields,
  157 older-value replays and 34 conflict cases. Both encodings round-trip, JSON
  whitespace/CRLF replays agree, and SDK read-back, relationships and native
  histories are preserved. Independent sequences use bounded history batches.
- `node --test --test-concurrency=1 test/conflict-interleaving.test.ts`: two
  regressions passed; 31 boundaries for each of seven real peer transitions,
  217 cases on one non-git tracker, plus 16 custom status registries and ambient
  focus. No state is shared or mutated by the witness operation.
- `node --test --test-concurrency=1 test/conflicts.test.ts`: six regressions
  passed, covering strict must-refuse and historical must-allow inputs, both
  source identities, exact scope, legacy local decisions, individual malformed
  records, typed remedies, limits, no-git operation, JSON/TOON and command exits.
- `node --test --test-concurrency=1 --test-name-pattern='packed conflict witness'
  test/install.acceptance.ts`: one acceptance test passed through npm global
  and Bun global executables. The complete installer suite additionally checks
  project-local npx and native bunx consumers in the CI release gates.
- `npm run typecheck`, `npm run build:test`, `npm run lint`, `npm run docstring`,
  and `npm run duplication`: passed; duplication remains zero. The linked pm
  test ran `npm run typecheck && npm run lint` and passed 1/1.

Behavioral revert proof: only `reviewConflicts` in a disposable source copy was
changed to omit opposition detection. The named opposed-judgments regression
failed with the assertion `no_opposition_observed` versus required `conflict`.
The unchanged package implementation subsequently passed that regression and
the complete focused boundary file. The package worktree was never reverted.

Overlap was rechecked against the pinned public SDK and sibling sources:
`lineageGroups` supplies confirmed finding identity; `requestSnapshot` supplies
verified native history addresses; `scopeDigest` preserves SDK-native values;
core JSON/TOON encoders supply the wire format. Core `PmClient.planDecision` and
the web decision inbox retain decision persistence and human response ownership.
There is no new native import/export/sync writer, plan, journal, claim, lease,
outbox, budget or lifecycle classification path.

The existing `pm-review-sdk-import-history-gap` remains separate: importing a
rich document over an existing linked item can make its history unverifiable.
The model seeds fresh native documents through `commitImportedItem`; unreadable
sources are separately tested as insufficient evidence without history repair.
Local ambient health reported a global-extension host-version skew; isolated
health passed. CI uses fresh hosts and runs the full npm and Bun release gates
at unchanged thresholds. Exact-head run URLs and gate counts are recorded on
the PR after verification; no full local release suite was started on the shared
host.
