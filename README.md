# pm-review

Bot review threads become durable pm context. Each thread, bot review body and bot issue comment is a typed `ReviewFinding` item. A fix or refusal keeps its reasoning beside the original finding, so the next agent can retrieve precedent with `pm search` or `pm review precedents`. Round completion becomes an exact-head query with an exit status.

Project management = context management.

## Install and release approval

The first npm release is pending the maintainer's interactive bootstrap. After
that first publish, the maintainer configures npm trusted publishing for
`release.yml` and sets the repository variable `PM_RELEASE_APPROVED` to `true`.
The daily workflow and manual dispatch both require this variable and `main`.
Publishing uses OIDC with provenance; no stored npm token is needed.

Once published, install the package and compatible pm host, then activate the
extension in an initialized pm project:

```sh
npm install pm-review @unbrained/pm-cli
npx --no-install pm package install ./node_modules/pm-review

bun add pm-review @unbrained/pm-cli
bunx --bun --no-install pm package install ./node_modules/pm-review

pm package install npm:pm-review
pm review --help
```

The package exports its SDK through `main` and `types` and registers commands
with pm. It has no standalone `bin`: use `npx pm` or `bunx --bun pm` through
the installed host. npm/Bun dependency installation alone does not activate it.

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

`respond` defaults to dry-run and lists every planned reply, vote and optional resolution. It reads the complete PR and tracker before writing anything. Replies use only recorded final verdicts and reasons; `fix` also requires and includes its fixing SHA. Source bot text is never echoed. Unsafe reasons containing mentions, private paths, credential patterns or hidden markup abort the plan before any writes. Correct the local verdict and retry. A hidden marker from the authenticated account binds the finding ID to a 16-character SHA-256 fingerprint of the recorded verdict, reason and fix commit. An unchanged decision stays answered even if surrounding reply text changes. Changed decisions receive a new reply explicitly superseding the earlier one; earlier replies remain as an audit trail. Legacy finding-ID markers without a fingerprint count as stale and receive a superseding reply on the next apply. A retry after a partial failure resumes remaining actions without reposting a current marked reply. Concurrent invocations should be serialized: GitHub does not offer an atomic marker-based reply mutation.

Verified withdrawn observations are listed in optional `withdrawn_items` receipts
and skipped by response/status requirements. Their lineage evidence stays intact,
and live siblings retain the shared verdict. A source that reappears becomes
eligible again; missing sources without verified withdrawal still fail safely.

Every nonempty contribution by a configured review bot is voted independently, including thread follow-ups, review bodies and issue comments. An existing thumbs-up or thumbs-down from the authenticated account counts as voted; other accounts and other reaction types do not. Review content receives 👍, including fixed findings and reasoned refusals. Unavailable-review notices receive 👎. Human contributions are excluded. No local tracker fields are changed by this command.

`--resolve` optionally resolves threads with final recorded decisions; default off lets services such as CodeRabbit resolve after re-review. `--bots` replaces the default comma-separated service list (CodeRabbit, Greptile, Gemini, Sourcery, Copilot, Codex, Cubic and Qodo); names ignore case and an optional `[bot]` suffix. Only accounts recognized as bots by the existing transport are eligible. `--notice-pattern` adds a case-insensitive regular expression to the built-in notice classifier. Both policy flags are also available on `status`.

`status` lists unvoted bot items, imported findings without final decisions, recorded thread verdicts without marked replies, `stale_replies` for findings with only outdated or legacy markers, and all unresolved threads, including human threads. It reuses `round` for completed CodeRabbit review evidence on the exact current head. Exit code is `0` only when those lists are empty and that review is complete. Automatic informational imports do not require a local verdict. Historical resolved threads without imported decisions do not require retroactive import; imported decisions require a marker matching their current decision fingerprint. Missing replies and stale replies are separate lists; stale replies block the gate until a current reply exists. Use `round` as well when gating CI checks and import completeness. Authentication, complete pagination and failure handling are shared with the existing client; partial data produces an error rather than a clear status. Both commands operate on behalf of the authenticated account.

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

Completion uses the same actionable-aware notice classifier as import and response voting. Unavailable notices (quota, access, ended trial, failed generation or incomplete actions) cannot establish completion. A substantive severity-marked review remains eligible when its body also contains a rate-limit notice or discusses rate-limit handling, once its findings are decided. Empty submitted reviews and genuine no-actionable-issues reviews remain supported.

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

The pinned SDK (2026.10.13) forwards `PmClient.schemaAddField`'s declared `type` correctly. pm-review uses that typed helper; real tracker tests verify stored schema types and numeric/boolean round trips. Successful round and status results omit `exit_code`; incomplete gates return `exit_code: 1`, as required by the host extension contract.

MIT licensed.

## Closeout verification

Run `pm review closeout <id> --base <commit> --json` before closing delegated
work. It compares item criteria with fresh linked tests and checks for weakened
policies, skipped/focused/deleted tests and unexecuted changed functions.
`--revert-check` additionally requires a behavioral test failure after source
restoration in a disposable copy. The command never closes or updates the item.
See [evidence binding, limitations and examples](docs/closeout.md).

## Without git

Targeted evidence request queues and their revision-bound arrivals work in plain
trackers without Git, credentials, provider calls or test execution.

Review imports, decisions, precedents and GitHub review commands do not require a
local Git checkout. Closeout runs linked tests in plain trackers and compares
linked artifacts against `closeout-before:<base64>` notes. It reports missing
states and skipped repository-wide checks explicitly. Only `--base` comparison
requires Git; GitHub commands require provider credentials and connectivity.
Criterion coverage reads and explicit judgment writes work in plain trackers
without git or GitHub access, using previously imported evidence. Finding lineage
reads and confirmations also work everywhere on existing tracker observations.
Revision-scoped review capture and comparison work in plain trackers using
verified SDK history; they need neither Git nor a review provider.

## Criterion review coverage

`pm review coverage <item>` shows which declared acceptance criteria have substantive
review attention and which remain unreviewed. Declare risk criteria in the same
`acceptance_criteria` contract. This adds what reviewers covered to `review round`'s
who-finished gate; it does not replace core assurance contracts or `review closeout`
proof. A `reviewed` judgment means attention, never correctness, approval or readiness.

```sh
pm review coverage sample-task --json
# Copy the revision and AC identifier from that result, then explicitly assess:
pm review cover sample-task --revision HASH --criterion AC1 \
  --evidence imported-finding-id --excerpt 'Validate the input before writing.' \
  --judgment reviewed --reason 'Reviews the invalid input boundary'
pm review coverage sample-task
```

The typed SDK exports `reviewCoverage`, `coverCriterion`, `CoverageResult` and
`CoverOptions`. TOON is the host default; `--json` returns the same compact shape.
Review bodies and excerpts are omitted from the map, while reasons, author/date,
reviewer and source links remain attributable. Refusals carry stable codes and
remedies. [Contract, SDK example and limitations](docs/criterion-coverage.md).

## Cross-provider finding lineage

`pm review lineage <item> --with <other>` proposes one logical finding across
provider observations and revisions. Confirm only after reviewing both sources,
using `--confirm --revision HASH --reason 'Why they are the same finding'`.
Near matches stay proposals until that explicit step. Confirmed observations share
one canonical disposition through the existing `review verdict` command; duplicate
imports and source withdrawal retain earlier reasoning without multiplying fixes.
Decision time selects the canonical observation. Differing independent decisions
refuse confirmation regardless of origin; invalid links produce diagnostics while
review work continues. SDK withdrawal requires `snapshotComplete: true` and an
unfiltered snapshot; partial imports never infer source withdrawal.

```sh
pm review lineage observation-a --with observation-b --json
pm review lineage observation-a --with observation-b --confirm \
  --revision HASH --reason 'Both identify the same unchecked write boundary'
pm review lineage observation-b
```

The exported `findingLineage` SDK operation returns the same compact TOON/JSON
shape, with typed refusal codes and remedies. It works without git or provider
access on previously imported observations. See the [SDK example, identity and
withdrawal contract](docs/finding-lineage.md).

## Provider-neutral review artifacts

`pm review ingest` imports an explicit code or document review artifact as
`ReviewFinding` items. It works in plain trackers through the PM SDK; git and
GitHub credentials are unnecessary. Existing `pm review import --repo ... --pr ...`
remains the live GitHub adapter with its current completion semantics.

Start with [the complete envelope example](examples/review-evidence.json):

```sh
# Verify the bytes against a digest obtained from the artifact's trusted source.
pm review ingest --file review-evidence.json --sha256 VERIFIED_SHA256
pm review ingest --url https://reviews.example.org/export/42 --sha256 VERIFIED_SHA256 --json
```

The v1 envelope requires `source.provider` (a lowercase slug), canonical HTTPS
`origin`, provider-native `artifact`, exact source `revision`, reviewed `subject`,
attributable `reviewer`, source `url` on that origin, `provenance.kind=declared`,
and 1–50 findings with distinct `id`, `summary` and `body`. Optional `path` and
positive `line` locate a finding. Revisions can be document versions or commit
hashes. Preserve the provider's revision verbatim; never substitute a current
workspace revision for a missing source revision. Unknown fields are refused.

Identity is the structured tuple `(provider, origin, artifact, revision, finding id)`.
Replaying the same content, including reordered JSON keys or finding rows, reuses
items without changing history or local verdicts. A new revision creates separate
observations and retains earlier revisions. Changed finding content under the same artifact
revision returns `identity_conflict` before writes; export a new revision. Finding lists may be imported in subsets;
each observation is immutable independently. Core
SDK locks protect deterministic item creation; retrying an interrupted import is
safe. An artifact import is a sequence of native item creates, so an unrelated
backend failure can leave a partial import; retry the original artifact.

The caller must pin file or HTTP bytes with a lowercase SHA-256 digest. HTTP(S)
GET requests have a 10-second timeout, refuse redirects and non-200 responses, and
send no credentials. Files must be regular files. Both transports read at most
1 MiB; finding bodies allow 16,000 characters and summaries 200. Source text stays
in the tracker. Receipts contain counts and at most 50 item selectors, rendered
as compact host TOON by default or JSON with `--json`. Refusals include stable
`refusal.code`, `refusal.remedy` and a nonzero CLI exit.

A digest proves byte integrity against the caller's pin. Provider, reviewer,
subject and revision remain **declared assertions**, not authenticated provider
attestations. Unsupported provenance is refused; every successful receipt says
`completion: unverified`. A claimed approval, provider name, GitHub-looking URL,
or commit-shaped revision cannot establish `review round` completion or criterion
coverage. Use a supported live adapter for completion evidence. Ingestion does
not resolve, close or withdraw findings. Explicit cross-provider identity remains
available through `review lineage`.

```ts
import { importEvidenceEnvelope, importReviewArtifact } from 'pm-review';
import type { ReviewEvidenceEnvelope } from 'pm-review';

// client is the host's PmClient; envelope is an explicit provider export.
const result = await importEvidenceEnvelope(client, envelope satisfies ReviewEvidenceEnvelope);
const receipt = await importReviewArtifact(client, {
  file: 'review-evidence.json', sha256: verifiedDigest,
});
if (!receipt.ok) console.error(receipt.refusal.code, receipt.refusal.remedy);
```

Use the item id returned by ingestion to record a local decision:

```sh
pm review verdict sample-ev-IDENTITY refuse --reason 'The contract already defines this behavior' --json
```

Envelope item ids derive from the provider, origin, artifact, revision and finding
identity. Their persisted envelope namespace selects the local verdict path;
`--repo`, `--pr` and `--apply` are refused with `envelope_verdict_local_only`.
No GitHub credentials, provider call or git executable is needed. GitHub findings
continue to require their original repo/PR coordinates and ownership checks.
Replay preserves the decision and reason; a verdict does not authenticate the
review source or establish review completion.

```ts
import { decide } from 'pm-review';
import type { VerdictInput } from 'pm-review';

if (result.ok) {
  const decision: VerdictInput = {
    id: result.items[0].id, verdict: 'refuse',
    reason: 'The contract already defines this behavior', commit: '', apply: false,
  };
  await decide(client, undefined, decision);
}
```

The typed importer validates runtime JSON before tracker writes. SDK consumers
passing parsed objects own their transport integrity checks; use
`importReviewArtifact` to enforce byte pins. Schema persistence, certified complete
reads, item creation, attribution and history use the PM SDK rather than a separate
storage or locking implementation.


## Revision-scoped review carry-forward

Capture explicitly reviewed native item fields and evidence at verified history
versions, then compare their digests with a new artifact:

```sh
pm review scope sample-task --file selection.json --json > baseline.json
pm review carry-forward sample-task --file baseline.json --json
```

Unrelated edits preserve unaffected obligations as attention. Changed criteria,
selected fields, or evidence revisions make dependent judgments stale. Omitted
criteria remain never reviewed. Retained attention always returns
`approval: unverified`; it cannot satisfy fresh exact-artifact review gates.

[Selection example, typed SDK, refusals and concurrency semantics](docs/review-carry-forward.md).

Release jobs with write permissions are restricted to `unbraind/pm-review` at job
level, so a fork cannot run publication with its own approval variable.

## Targeted evidence requests

`pm review requests --file examples/review-requests.json [--json]` requests one
missing source excerpt or focused test artifact per selected unresolved finding
or criterion gap. The typed `reviewEvidenceRequests(client, packet)` SDK returns
the same bounded queue, explicit revision-bound arrival receipts, typed refusals
with remedies, exact UTF-8 JSON/TOON budgets, minimum-budget refusals, and exact
omissions. Arrival records acquisition and leaves
approval unverified. See the [packet example](examples/review-requests.json) and
[request and arrival contract](docs/evidence-requests.md).
