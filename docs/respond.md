# Batch response acceptance

Feature: [pm-review-respond](../.agents/pm/features/pm-review-respond.toon).

Before this feature, recorded verdicts required individual application and a separate private voting loop. `respond` reads the complete tracker and GitHub snapshot, plans marked inline replies and missing votes, and applies only with an explicit flag. Thread resolution is opt-in. `status` exposes the unanswered work and reuses round evaluation for exact-head review evidence.

The HTTP fixture server exercises the actual GraphQL transport and real temporary PM trackers, without SDK mocks. Connections use one-element pages, including nested replies and reactions. Five scenarios cover dry-run, fix/refusal replies, every contribution category, human exclusion, configurable policy, retries after partial failure, unsafe reasons, incomplete decisions and partial API responses. Packed npm and Bun consumers also discover both commands.

## Behavioural revert proofs

`node --test --test-name-pattern='respond HTTP dry-run' test/respond.test.ts` fails separately when only:

- `hasReply` is reverted to always report no matching marker: the retry unexpectedly plans another reply.
- `responsePlan` selects positive votes for every source: the ended-trial notice fails its downvote assertion.
- `responsePlan` selects negative votes for every source: substantive review content fails its upvote assertion.

Each mutation exited 1. The implementation was restored after each proof. Full release gates run against the restored implementation.

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
