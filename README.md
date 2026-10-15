# pm-review

Bot review threads become durable pm context. Each thread, bot review body and bot issue comment is a typed `ReviewFinding` item. A fix or refusal keeps its reasoning beside the original finding, so the next agent can retrieve precedent with `pm search` or `pm review precedents`. Round completion becomes an exact-head query with an exit status.

Project management = context management.

## Install

This new package is unreleased. The registry examples below apply after maintainer-approved publication. For local evaluation, build and pack the package, then install the resulting tarball into a scratch project.

```sh
npm ci
npm run build
npm pack
pm install ./pm-review-2026.10.12.tgz --project
```

After publication:

```sh
pm install pm-review --project
npm install pm-review @unbrained/pm-cli
bun add pm-review @unbrained/pm-cli
npx --package @unbrained/pm-cli --package pm-review pm install pm-review --project
bunx --bun --package @unbrained/pm-cli pm install pm-review --project
```

npm and Bun dependency installation make the package available to your application. `pm install` installs and activates its extension for the project. A consuming SDK host can also import the extension and register it through the PM extension loader.

Requires Node 22.18 or later and PM CLI/SDK 2026.10.13 or later. Authentication follows pm-github: `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`. Credentials stay in memory and never appear in receipts. The endpoint is GitHub.com; redirects are refused and each network request has a deadline.

## Import

```sh
pm review import --repo unbraind/pm-rl --pr 68
pm review import --repo unbraind/pm-rl --pr 68 --json
```

Example structured output (counts depend on the PR snapshot):

```json
{
  "repo": "unbraind/pm-rl",
  "pr": 68,
  "head": "14669bcf58229e7226eed958470babc06c88d570",
  "created": 50,
  "updated": 0,
  "items": [
    { "id": "acceptance-gh-db4f75c86e8510641a6c6fb1", "node_id": "PRRT_kwDOTqJmqs6rNjCa", "verdict": "pending" }
  ]
}
```

The item array above is shortened to the first of 50 identities from read-only acceptance; actual output includes every imported identity. Re-importing the same nodes creates zero duplicates and updates source text, resolution and provenance while preserving explicit local verdicts, reasons, commits and audit comments. Import-assigned classifications are refreshed from the current source, so a notice that becomes actionable returns to `pending`.

All GitHub connections are paginated, including nested thread replies, reactions and check runs. A changed PR head or incomplete/malformed response aborts the snapshot before import. One item represents a bot thread using its thread node id and first bot finding. Subsequent replies remain available for application and vote checks. Nonempty bot review bodies and bot issue comments use their own node ids. Human-only threads and empty review bodies are not imported as bot findings.

Fields are namespaced as `review_*`: bot, kind, path, line, severity, summary, URL, node id, original head, verdict, verdict source, resolved state, repository, PR, thread id, decision reason and decision commit. Every import also links the observed PR commits in the body and metadata. `review_line=0` means GitHub supplied no line. Unknown severity is explicit. CodeRabbit, Greptile, Gemini and Sourcery severity/priority markers are parsed when available.

Thread comments use GitHub's `originalCommit`; reviews use their `commit`. Issue comments have no original-commit property, so their head is empty and `review_head_source=unknown`. The current head in the import receipt describes the snapshot, without assigning that commit to older comments.

Rate-limit notices, ended trials, failed/skipped reviews, full-review confirmations and walkthrough summaries are imported with an `informational` verdict. They are closed with resolution `informational` and structured expected/actual evidence. They remain searchable and eligible for source voting, without appearing in open findings, and do not establish a finished substantive review.

## Verdict

```sh
pm review verdict sample-gh-685da68fb5e0aeb61aa0b653 refuse \
  --repo unbraind/pm-rl --pr 68 \
  --reason "The existing schema validates this input before any write"
```

```text
item: sample-gh-685da68fb5e0aeb61aa0b653
verdict: refuse
applied: false
replied: false
reacted: false
resolved: false
```

The `review_verdict_source` field distinguishes `import` classifications from `local` decisions. Legacy findings with a decision reason, decision commit or final actionable verdict retain their local decision; undecided legacy notices are reclassified on import.

Every verdict requires a nonempty reason. The command records an idempotent pm comment and typed decision fields. An optional `--commit <sha>` links the implementing or explanatory commit. Without `--apply`, it changes only the local tracker and does not need a GitHub token.

For an authorized thread action:

```sh
pm review verdict sample-gh-685da68fb5e0aeb61aa0b653 fix \
  --repo example/package --pr 1 \
  --reason "Added validation before persistence" --commit aaaaaaa --apply
```

```text
item: sample-gh-685da68fb5e0aeb61aa0b653
verdict: fix
applied: true
replied: true
reacted: true
resolved: true
```

`--apply` checks the live thread and authenticated account, posts the reason as a marked reply, adds 👍 for `fix`, `informational`, `duplicate` or `stale` and 👎 for `refuse`, then resolves the thread. Repeating the same decision checks its exact marked reply and that account's reactions; existing replies, reactions and resolutions are retained without duplicate writes. A partial network failure can be retried with the same decision. The local decision is durable before remote actions begin. Successful application closes the finding with the verdict, reason and commit evidence through one SDK close call; partial failures leave actionable items active for retry. Applying `fix` requires `--commit`. `fixed` and `refused` are accepted aliases for `fix` and `refuse`. Local verdicts without `--apply` do not close actionable findings.

Application is supported for final verdicts on all imported findings. A pending verdict remains local and cannot be applied. For review bodies and issue comments, `--apply` votes on the selected source only: 👍 for review content, including summaries and guides; 👎 for unavailable or incomplete review notices (ended trials, access limits, rate limits, skipped reviews and actions not completed). Threads retain verdict-based votes, replies and resolution. Re-applying adds no duplicate reaction from the applying account. The item must belong to the supplied repository and PR. Never use a real PR for unapproved mutation testing; the package's write tests use synthetic responses.

| Verdict | Meaning |
| --- | --- |
| `pending` | Needs an explicit decision; blocks completion. |
| `fix` | Accepted and addressed; record what changed and its commit. |
| `refuse` | Rejected with reusable technical reasoning. |
| `duplicate` | Covered by another finding; identify that context in the reason. |
| `stale` | No longer applies to the current code; explain why. |
| `informational` | Context without an actionable code change. |

## Respond and status

```sh
pm review respond --repo example/package --pr 1 --json
pm review respond --repo example/package --pr 1 --apply --json
pm review status --repo example/package --pr 1 --json
```

`respond` defaults to dry-run and lists every planned reply, vote and optional resolution. It reads the complete PR and tracker before writing anything. Replies use only recorded final verdicts and reasons; `fix` also requires and includes its fixing SHA. Source bot text is never echoed. Unsafe reasons containing mentions, private paths, credential patterns or hidden markup abort the plan before any writes. Correct the local verdict and retry. A hidden finding-id marker from the authenticated account identifies an earlier response even if surrounding text changes. A retry after a partial failure resumes remaining actions without reposting a marked reply. Concurrent invocations should be serialized: GitHub does not offer an atomic marker-based reply mutation.

Every nonempty contribution by a configured review bot is voted independently, including thread follow-ups, review bodies and issue comments. An existing thumbs-up or thumbs-down from the authenticated account counts as voted; other accounts and other reaction types do not. Review content receives 👍, including fixed findings and reasoned refusals. Unavailable-review notices receive 👎. Human contributions are excluded. No local tracker fields are changed by this command.

`--resolve` optionally resolves threads with final recorded decisions; default off lets services such as CodeRabbit resolve after re-review. `--bots` replaces the default comma-separated service list (CodeRabbit, Greptile, Gemini, Sourcery, Copilot, Codex, Cubic and Qodo); names ignore case and an optional `[bot]` suffix. Only accounts recognized as bots by the existing transport are eligible. `--notice-pattern` adds a case-insensitive regular expression to the built-in notice classifier. Both policy flags are also available on `status`.

`status` lists unvoted bot items, imported findings without final decisions, recorded thread verdicts without marked replies and all unresolved threads, including human threads. It reuses `round` for completed CodeRabbit review evidence on the exact current head. Exit code is `0` only when those lists are empty and that review is complete. Automatic informational imports do not require a local verdict. Historical resolved threads without imported decisions do not require retroactive import; imported decisions require their finding-id markers. Use `round` as well when gating CI checks and import completeness. Authentication, complete pagination and failure handling are shared with the existing client; partial data produces an error rather than a clear status. Both commands operate on behalf of the authenticated account.

## Reconcile

```sh
pm review reconcile --repo unbraind/pm-review --pr 1 --dry-run --json
pm review reconcile --repo unbraind/pm-review --pr 1 --json
```

Reconcile reads live GitHub state and closes active findings from resolved bot threads, fixed or dismissed linked code-scanning alerts, and merged PRs. Informational source context is closed as well, including legacy notices. The receipt lists planned closures and their evidence, plus before/after active finding counts. `--dry-run` writes nothing and reports zero applied closures. Repeating an applied reconciliation produces zero further closures and no new closure history.

All GitHub operations are read-only. Reads complete before any tracker write; unreadable PR state, malformed responses and unexpected transport errors abort reconciliation. Alert links must belong to the same repository. A 403 or 404 alert response leaves alert-only findings open and reports their IDs and HTTP status in the receipt's `skipped` list; independent thread-resolution evidence still closes findings. Missing, null (unknown) or open alert evidence alone cannot close a finding. A merged PR skips alert reads and retires all remaining findings for that PR, including source nodes that disappeared, without claiming each individual issue was fixed. Closure preserves local verdicts and reasons and records source resolution separately. It never changes findings for another PR or repository, ordinary work items or canceled findings. Closed findings no longer count as pending in a round; live thread and vote requirements still apply.

Import-derived closed notices reopen if their source becomes actionable on re-import. Successful verdict application replaces their import-derived resolution and actual result with the verdict, reason and commit evidence, including after a failed application is retried; explicit local closures stay terminal. Titles omit static-analysis and AI-agent prompt wrappers to expose the actionable heading.

## Round

```sh
pm review round --repo unbraind/pm-rl --pr 68 --json
pm review round --repo unbraind/pm-rl --pr 68 --compact
```

Example compact host-rendered output:

```text
"review unbraind/pm-rl#68 head=14669bcf58229e7226eed958470babc06c88d570 complete=false checks=pending coderabbit=finished unresolved=0 unvoted=0 pending=14 unimported=0"
```

The full TOON/JSON receipt keeps unresolved thread ids and adds `unresolved_thread_details` with the item id, bot, current path/line, severity and one-line summary for each blocker. An unimported or human-only thread has a null item id. It also lists bot comments without a PR-author reaction, pending pm item ids and missing import node ids. Exit code `0` means complete; `1` means incomplete. With both `--compact` and global `--json`, JSON retains the complete receipt.

Completion requires:

- Successful checks on the current head. Failure wins over pending; missing, skipped and neutral checks remain incomplete.
- A completed CodeRabbit review object naming that exact head. Completion replies alone cannot establish which head was reviewed. Pending/dismissed reviews and quota/failure notices do not substitute.
- Zero unresolved review threads, including human threads.
- A reaction from the PR author account on every nonempty bot comment/review body. Another account's vote does not substitute.
- No pending imported findings and no current source nodes missing from the tracker.

The gate reads GitHub again each time. A local `review_resolved` field is never accepted as live resolution evidence. A completed round describes these measured conditions; it does not grant merge, release or deployment authority.

## Find

```sh
pm review find --thread PRRT_example
pm review find --thread https://github.com/example/package/pull/1#discussion_r1 --json
```

Lookup reads the complete local tracker, including terminal items, and returns matching items without GitHub authentication. Thread ids and imported source comment URLs identify the durable item directly. No matches returns an empty item list.

## Precedents

```sh
pm review precedents "schema validation"
pm review precedents "schema validation" --repo unbraind/pm-rl
pm review precedents "schema validation" --repo unbraind/pm-rl --pr 68 --json
pm search "validation" --type ReviewFinding
```

```json
{
  "query": "schema validation",
  "count": 1,
  "items": [
    {
      "id": "sample-gh-685da68fb5e0aeb61aa0b653",
      "verdict": "refuse",
      "summary": "Validate the input before writing.",
      "reason": "Existing schema validation prevents invalid input.",
      "url": "https://github.com/example/package/pull/1#discussion_r1",
      "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  ]
}
```

Precedents search `fix` and `refuse` items across the complete tracker, including closed items. Every query word must appear in the summary, original finding or retained reasoning. Optional `--repo` and `--pr` together scope the search. This command is offline. Import persists the custom type and field schema through the SDK, making ordinary `pm search` work even when extension loading is disabled.

## Development and evidence

```sh
npm run release:check
bun run release:check
npm run test:install
npm run changelog:full
```

The release gates enforce typechecking, fleet ESLint/jscpd/docstrings, statement/branch/function/line coverage at 100%, production audit, package allowlist, generated changelog, publish attestation and packed npm/Bun acceptance. Coverage includes authored executable source and package tooling, with source-inventory reconciliation and invalidation of failed reports. Tests use real temporary PM trackers without SDK mocks. Public read-only GitHub fixtures are recorded from pm-rl#68; fixture metadata records the capture head and operations without tokens. Synthetic mutations exercise apply without changing a real PR.

Implementation and acceptance receipts live in this package's `.agents/pm` tracker. Its epic links companion `pm-cli-website-ox5m`. Items remain open for orchestrator verification. The release workflow has no schedule and requires explicit maintainer enablement and dispatch.

Known SDK boundary: `PmClient.schemaAddField` drops its declared `type` in the pinned SDK. pm-review uses the public `client.run('schema', ...)` action with `fieldType`, verified by numeric and boolean round-trip tests. No upstream source is patched.

MIT licensed.
