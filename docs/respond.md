# Batch response acceptance

Feature: [pm-review-respond](../.agents/pm/features/pm-review-respond.toon).

Before this feature, recorded verdicts required individual application and a separate private voting loop. `respond` reads the complete tracker and GitHub snapshot, plans marked inline replies and missing votes, and applies only with an explicit flag. Thread resolution is opt-in. `status` exposes the unanswered work and reuses round evaluation for exact-head review evidence.

The HTTP fixture server exercises the actual GraphQL transport and real temporary PM trackers, without SDK mocks. Connections use one-element pages, including nested replies and reactions. Seven scenarios cover dry-run, fix/refusal replies, every contribution category, human exclusion, configurable policy, retries after partial failure, unsafe reasons, incomplete decisions, partial API responses, changed-reason supersession and legacy-marker migration with changed fix commits. Packed npm and Bun consumers also discover both commands.

## Decision fingerprints and stale replies

Batch response markers use `<!-- pm-review:finding:<encoded-id> decision:<fingerprint> -->`. The fingerprint is the first 16 hexadecimal characters of SHA-256 over a JSON array containing the recorded verdict, reason and fix commit (empty for other verdicts). Only a matching marker from the authenticated account satisfies the current decision; changing the verdict, reason or fix commit requires a new reply.

`status.stale_replies` lists finding IDs with an earlier marker but no current one. `verdicts_without_reply` lists findings with no marked reply from that account. Both lists block the gate. Legacy finding-ID markers without a fingerprint count as stale. Applying a correction appends a reply saying it supersedes the earlier reply; it never edits or deletes the earlier reply. Once a current reply exists, historical markers no longer block status, and sequential retries post nothing.

## Behavioural revert proofs

`node --test --test-name-pattern='respond HTTP dry-run' test/respond.test.ts` fails separately when only:

- `hasReply` is reverted to always report no matching marker: the retry unexpectedly plans another reply.
- `responsePlan` selects positive votes for every source: the ended-trial notice fails its downvote assertion.
- `responsePlan` selects negative votes for every source: substantive review content fails its upvote assertion.

Each mutation exited 1. The implementation was restored after each proof. Full release gates run against the restored implementation.

Round 1 fingerprint proof: `node --test --test-name-pattern='respond HTTP changed reason' test/respond.test.ts` fails when only `hasReply` discards the decision fingerprint before matching. The stale-status assertion receives an empty list instead of the finding ID (0 passed, 1 failed; exit 1). The exact implementation was restored before the release gates. The unchanged implementation passes the HTTP suite (7 passed, 0 failed).

## Public read-only proof

The packed CLI was run against merged public PR `unbraind/pm-github#124`. No real repository received an apply command.

`pm review status --repo unbraind/pm-github --pr 124 --json` exited 0:

```json
{
  "repo": "unbraind/pm-github",
  "pr": 124,
  "head": "573c1a658c62031a3110d086839e5cb00b34d7aa",
  "complete": true,
  "unvoted_bot_items": [],
  "findings_without_verdict": [],
  "verdicts_without_reply": [],
  "unresolved_threads": [],
  "current_head_review_completed": true
}
```

`pm review respond --repo unbraind/pm-github --pr 124 --json` exited 0:

```json
{
  "repo": "unbraind/pm-github",
  "pr": 124,
  "dry_run": true,
  "actions": []
}
```

Clear status results omit an explicit success code because the pinned host accepts only failure codes in extension results. The existing round command's explicit-zero result is tracked separately in [pm-review-round-exit-contract](../.agents/pm/issues/pm-review-round-exit-contract.toon).

Concurrent apply invocations must be serialized. Marker detection makes sequential retries idempotent; GitHub does not expose an atomic conditional thread-reply mutation.

## Round 1 release gates

Both complete release checks passed on commit `656c0ea` (runtime implementation `476d335`). The final receipt commit adds only documentation and tracker evidence.

| Command | Suite | Packed consumer acceptance | Statements / branches / functions / lines |
| --- | --- | --- | --- |
| `npm run release:check` | 123 passed, 0 failed, 0 skipped | 1 passed | 100 / 100 / 100 / 100 |
| `bun run release:check` | 123 passed, 0 failed, 0 skipped | 1 passed | 100 / 100 / 100 / 100 |

Each ran with a fresh HOME, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `npm_config_ignore_scripts=true`. The measured inventory remains 20 source files. All thresholds and dependency pins are unchanged; duplication is zero, the production audit is clean, and identity, type, lint, docstring, package, changelog and attestation checks pass. The linked HTTP command passed 7/7 through `pm test`; the changed-reason behavioral revert failed as expected before restoration. Changelog generation and checking were repeated after the final tracker writes.

## Initial feature release gates

Runtime code commit: `01e3278`. The final receipt commit changes only documentation and tracker evidence.

| Command | Suite | Packed consumer acceptance | Statements / branches / functions / lines |
| --- | --- | --- | --- |
| `npm run release:check` | 121 passed, 0 failed, 0 skipped | 1 passed | 100 / 100 / 100 / 100 |
| `bun run release:check` | 121 passed, 0 failed, 0 skipped | 1 passed | 100 / 100 / 100 / 100 |

Each command ran with a fresh HOME, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` and `npm_config_ignore_scripts=true`. Install hooks were suppressed to avoid shared Git configuration changes; all explicit build and gate scripts ran. The coverage inventory contained 20 source files, thresholds were unchanged, duplication was zero and the production audit was clean. Identity, type, lint, docstring, package, changelog and attestation checks passed in both runs.

The linked HTTP test command passed through `pm test` with a 600-second budget: 5 passed, 0 failed. Its initial 120-second runner budget timed out under shared-host load; increasing the budget required no test or implementation changes. Changelog generation and checking were repeated after the final tracker writes.
