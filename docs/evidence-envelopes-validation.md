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
