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

Requires Node 22.18 or later and PM CLI/SDK 2026.10.10 or later. Authentication follows pm-github: `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`. Credentials stay in memory and never appear in receipts. The endpoint is GitHub.com; redirects are refused and each network request has a deadline.

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

The item array above is shortened to the first of 50 identities from read-only acceptance; actual output includes every imported identity. Re-importing the same nodes creates zero duplicates and updates source text, resolution and provenance while preserving verdicts, reasons, commits and audit comments.

All GitHub connections are paginated, including nested thread replies, reactions and check runs. A changed PR head or incomplete/malformed response aborts the snapshot before import. One item represents a bot thread using its thread node id and first bot finding. Subsequent replies remain available for application and vote checks. Nonempty bot review bodies and bot issue comments use their own node ids. Human-only threads and empty review bodies are not imported as bot findings.

Fields are namespaced as `review_*`: bot, kind, path, line, severity, summary, URL, node id, original head, verdict, resolved state, repository, PR, thread id, decision reason and decision commit. Every import also links the observed PR commits in the body and metadata. `review_line=0` means GitHub supplied no line. Unknown severity is explicit. CodeRabbit, Greptile, Gemini and Sourcery severity/priority markers are parsed when available.

Thread comments use GitHub's `originalCommit`; reviews use their `commit`. Issue comments have no original-commit property, so their head is empty and `review_head_source=unknown`. The current head in the import receipt describes the snapshot, without assigning that commit to older comments.

Rate-limit notices, ended trials, failed/skipped reviews, full-review confirmations and walkthrough summaries are imported with an `informational` verdict. They remain searchable context and do not establish a finished substantive review.

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

`--apply` checks the live thread and authenticated account, posts the reason as a marked reply, adds 👍 for `fix` or `informational` and 👎 for `refuse`, then resolves the thread. Other verdicts post a reason and resolve without inventing a reaction. Repeating the same decision checks its exact marked reply and that account's reactions; existing replies, reactions and resolutions are retained without duplicate writes. A partial network failure can be retried with the same decision. The local decision is durable before remote actions begin.

Application is supported for final verdicts on thread items. A pending verdict remains local and cannot be applied. Review-body and issue-comment verdicts remain local because they have no review-thread reply/resolution target. The item must belong to the supplied repository and PR. Never use a real PR for unapproved mutation testing; the package's write tests use synthetic responses.

| Verdict | Meaning |
| --- | --- |
| `pending` | Needs an explicit decision; blocks completion. |
| `fix` | Accepted and addressed; record what changed and its commit. |
| `refuse` | Rejected with reusable technical reasoning. |
| `duplicate` | Covered by another finding; identify that context in the reason. |
| `stale` | No longer applies to the current code; explain why. |
| `informational` | Context without an actionable code change. |

## Round

```sh
pm review round --repo unbraind/pm-rl --pr 68 --json
pm review round --repo unbraind/pm-rl --pr 68 --compact
```

Example compact host-rendered output:

```text
"review unbraind/pm-rl#68 head=14669bcf58229e7226eed958470babc06c88d570 complete=false checks=pending coderabbit=finished unresolved=0 unvoted=0 pending=14 unimported=0"
```

The full TOON/JSON receipt lists unresolved thread ids, bot comments without a PR-author reaction, pending pm item ids and missing import node ids. Exit code `0` means complete; `1` means incomplete. With both `--compact` and global `--json`, JSON retains the complete receipt.

Completion requires:

- Successful checks on the current head. Failure wins over pending; missing, skipped and neutral checks remain incomplete.
- A completed CodeRabbit review object naming that exact head. Completion replies alone cannot establish which head was reviewed. Pending/dismissed reviews and quota/failure notices do not substitute.
- Zero unresolved review threads, including human threads.
- A reaction from the PR author account on every nonempty bot comment/review body. Another account's vote does not substitute.
- No pending imported findings and no current source nodes missing from the tracker.

The gate reads GitHub again each time. A local `review_resolved` field is never accepted as live resolution evidence. A completed round describes these measured conditions; it does not grant merge, release or deployment authority.

## Precedents

```sh
pm review precedents "schema validation"
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
