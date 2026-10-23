# Evidence envelope validation

Public source: `unbraind/pm-review`, main snapshot
`ce32408` (tracker reconciliation). Export only `.agents/pm` into a non-git
scratch directory. Durable source files are read-only; imports target a separate
plain tracker initialized through the SDK. No source provider writes occur.

Run the reproducible helper with the exported tracker and a separate scratch
output directory:

```sh
GIT_CEILING_DIRECTORIES=SCRATCH_PARENT node test/envelope-public-tracker.ts PUBLIC_TRACKER SCRATCH_DIRECTORY
```

| Measurement | Result |
| --- | ---: |
| Public tracker items | 51 |
| Existing ReviewFinding observations | 22 |
| Observations with recorded source revisions | 17 |
| Missing-revision observations held without inventing provenance | 5 |
| Local-file imports created | 17 |
| Synthetic HTTP replay reused | 17 |
| Distinct original revisions preserved | 2 |
| Durable source files unchanged (name and byte fingerprint) | 108 |
| Largest receipt, JSON bytes | 254 |
| Completion claims established | 0 |

The helper verifies retained source text and revision for every imported finding,
checks both import receipts, certifies the complete target inventory through the
SDK, and fingerprints the source before and after. These numbers measure this
public corpus; they do not attest arbitrary providers or remote PM backends.

The targeted suite includes native SDK create races, immutable-content conflicts,
source namespace separation, revision retention, runtime JSON validation, bounded
file/HTTP reads, digest mismatch, redirects and incomplete responses. Real host
processes use a PATH with only Node and `GIT_CEILING_DIRECTORIES` outside the
tracker to establish that ingestion does not invoke git. Packed npm and Bun
acceptance also import and replay the envelope through the installed command.

Behavioral revert proof: in an isolated source copy, remove only `source.revision`
from `importEvidenceEnvelope`'s structured identity scope. Run:

```sh
node --test --test-name-pattern='envelopes deduplicate immutable revisions' test/envelopes.test.ts
```

The named regression fails its new-revision assertion (`created` is undefined
instead of 2). The unchanged implementation passes. This is a behavioral failure,
not a missing export, compilation error, or unavailable test dependency.

## Verified gates

Code candidate `235148e` passed [CI run 39992563740](https://github.com/unbraind/pm-review/actions/runs/39992563740):

- npm on Node 22: 221/221 tests; packed npm/Bun acceptance 1/1.
- npm on Node 26: 221/221 tests; packed npm/Bun acceptance 1/1.
- `bun run release:check` on Node 26: 221/221 tests; packed acceptance 1/1.
- Each full coverage run reported all 34 configured source files at
  100% statements, branches, functions and lines. Docstrings cover 114 declarations;
  duplication remains 0%. Thresholds and source inventory policy are unchanged.

Local `pm test pm-review-evidence-envelopes --run --progress` passed its linked
`node --test test/envelopes.test.ts` command: 10/10 tests, exit 0. The link uses a
1200-second budget for a saturated host; the initial default 120-second timeout
is retained in execution history. `npm run typecheck`, `npm run build:test`,
`npm run lint`, `npm run docstring`, `npm run duplication` and
`npm run changelog:check` passed. The erased type module is explicitly loaded by
the test suite, following the existing coverage contract rather than omitting it.

The installed CLI 2026.10.23 overlap check confirms structured notes have no
ReviewFinding lifecycle. pm-observer's public adapter and outbox contracts capture
agent-event evidence and notes; this package owns review observations and lifecycle.
The pinned development SDK remains unchanged. Host-global pm-github version skew
requires a clean HOME for local health parity; isolated health and both fresh CI
jobs pass. No upstream CLI/SDK defect was reproduced.
