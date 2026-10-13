# PR 1 review round two evidence

Author: `codex-agent`. Decisions are local; no verdict was applied remotely. Work items remain open or in progress for orchestrator verification.

## Thread decisions

| Comment | Verdict | Change | Behavioral check |
| --- | --- | --- | --- |
| [4258284083](https://github.com/unbraind/pm-review/pull/1#discussion_r4258284083) | fix | Require a submitted, completed CodeRabbit review for the exact head in active acceptance criteria; preserve history. | `node --test --test-name-pattern="round rejects completion replies" test/core.test.ts` passes. |
| [4258284088](https://github.com/unbraind/pm-review/pull/1#discussion_r4258284088) | fix | Parse the final pack JSON array after npm 10 prepare output in the release workflow. | `node --test --test-name-pattern="release pack manifest" test/tooling.test.ts` fails after reverting the workflow fix and passes after restoration. |
| [4258284108](https://github.com/unbraind/pm-review/pull/1#discussion_r4258284108) | fix | Resolve the repository root inside the coverage gate for exported and CLI callers. | `node --test --test-name-pattern="coverage gate anchors" test/tooling.test.ts` fails after reverting root anchoring and passes after restoration; also exercises the real CLI with a relative root. |
| [4258284120](https://github.com/unbraind/pm-review/pull/1#discussion_r4258284120) | fix | Raise the identity gate patch read buffer to 512 MiB. | `node --test --test-name-pattern="identity policy reads" test/tooling.test.ts` fails with ENOBUFS after reverting the buffer fix and passes after restoration. |

## Dogfood

Fixed: new bold CodeRabbit severity badges map Major to high and Minor to low. `node --test --test-name-pattern="marker parsing" test/core.test.ts` fails with the parser fix reverted and passes when restored.

Fixed: extension errors preserve useful host CLI messages. `node --test --test-name-pattern="extension failures" test/core.test.ts` fails with the command error boundary reverted and passes when restored. It covers existing SDK errors, non-Error throws, missing and invalid input, and the synthetic network boundary. Live CLI invalid verdict, empty reason and missing-item checks each return the actual message with exit 2.

Every proof temporarily reverted only its production file to the original base and verified byte-for-byte restoration. The final consolidated error regression was independently checked again after resolving lint and duplication failures.

Remaining: `pm-review-summary-ux` tracks static-analysis wrapper headings chosen as finding summaries; `pm-review-help-ux` tracks repeated value placeholders in host help. Earlier SDK registration and development dependency follow-ups remain `pm-review-sdk-gap` and `pm-review-dev-audit`.

## Validation history

The initial linked npm gate found require-atomic-updates in the added regression. Fresh context objects resolved it. The next duplication check found repeated setup, so the regression was consolidated into the existing validation test without dropping previous assertions. A standalone linked core run exceeded its former 120-second timeout under host load; its linked timeout is now 600 seconds.

The subsequent full npm run passed 85 coverage tests with zero skips and 100 percent statements, branches, functions and lines across 17 authored source files. Production audit reported zero vulnerabilities. It then stopped at changelog validation because PM updates changed generated entry ordering. The changelog was regenerated before final certification.

The original scratch task and dated rules files were unavailable. This continuation's explicit scope and supplied rules governed the work.

## Items touched

Work and follow-up items: `pm-review-quality`, `pm-review-round`, `pm-review-summary-ux`, `pm-review-help-ux`.

The dogfood import retained all 22 current public bot findings and context records. The four round-two thread records received local fix verdicts; historical pending decisions were preserved.

| Imported item | GitHub source identity |
| --- | --- |
| `pm-review-gh-91c81475a10045016ff3d2fe` | `PRRT_kwDOVGABD86rdeUe` |
| `pm-review-gh-fcc4fe2547554c06f3402e3c` | `PRRT_kwDOVGABD86rdeUv` |
| `pm-review-gh-e42de0001e8f08c535d7dff8` | `PRRT_kwDOVGABD86rdeU5` |
| `pm-review-gh-90f7c5234969bd35da36bb39` | `PRRT_kwDOVGABD86reZSN` |
| `pm-review-gh-300d404ccc6050b4b5da589a` | `PRRT_kwDOVGABD86reZSd` |
| `pm-review-gh-2c5d13c400035aff589849a2` | `PRRT_kwDOVGABD86reZS0` |
| `pm-review-gh-33c714f8e3cfe97db7eb821d` | `PRRT_kwDOVGABD86reZS3` |
| `pm-review-gh-080f2180d3733dfb2533e992` | `PRRT_kwDOVGABD86reZTD` |
| `pm-review-gh-aca6c43075af8d69f4fb9a9b` | `PRRT_kwDOVGABD86reZTO` |
| `pm-review-gh-93684c3be62cabcfe63f51fc` | `PRRT_kwDOVGABD86reZTV` |
| `pm-review-gh-4fe7132133cc04f1d104a05c` | `PRRT_kwDOVGABD86reZTq` |
| `pm-review-gh-b8d0ce4233d43151b6ae2029` | `PRRT_kwDOVGABD86r2EyW` |
| `pm-review-gh-77f0ef9d8d9a0823cf38c1a4` | `PRRT_kwDOVGABD86r2Eyb` |
| `pm-review-gh-3756aee5638da26537c52013` | `PRRT_kwDOVGABD86r2Eyn` |
| `pm-review-gh-ba23afc402641b64f22d341a` | `PRRT_kwDOVGABD86r2Eyv` |
| `pm-review-gh-62f3c6c9f2d29d92515c6046` | `PRR_kwDOVGABD88AAAABR09awQ` |
| `pm-review-gh-62994f50a613b4005c178d77` | `PRR_kwDOVGABD88AAAABSAKM7w` |
| `pm-review-gh-28697439f32d9689fa28611d` | `IC_kwDOVGABD88AAAABbQsy2w` |
| `pm-review-gh-b0d87dd071a6a4f0cff46215` | `IC_kwDOVGABD88AAAABbQs8KQ` |
| `pm-review-gh-f2f579d4b6d672c020c36332` | `IC_kwDOVGABD88AAAABbQtoSw` |
| `pm-review-gh-5e614f78db4d44b38d159bdc` | `IC_kwDOVGABD88AAAABbRMgAA` |
| `pm-review-gh-5401fc1422f7e46f3479fd80` | `IC_kwDOVGABD88AAAABbkMzvA` |

## Final certification

- `npm run release:check`: passed, exit 0, through `pm test pm-review-quality --run --only-index 3 --progress --timeout 2400`.
- `bun run release:check`: passed, exit 0, through `pm test pm-review-quality --run --only-index 4 --progress --timeout 2400`.
- Each full gate passed all 85 coverage tests with zero skips and measured 100 percent statements, branches, functions and lines across all 17 configured authored source files.
- Each full gate passed production audit, zero-duplication policy, documentation, changelog, publish attestation, package allowlist and real packed npm/npx plus native Bun/bunx consumer acceptance.
- All five production files still matched their independently verified byte restoration hashes after certification.

Fix commit for all four threads and both dogfood corrections: [defdd9078d6ed88d6fafcd42437920108f755984](https://github.com/unbraind/pm-review/commit/defdd9078d6ed88d6fafcd42437920108f755984). Each current thread item records that SHA in review_commit.
