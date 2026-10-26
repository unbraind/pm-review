# Targeted review evidence requests

`pm review requests --file examples/review-requests.json` compiles explicit selections
into a compact TOON queue. Add `--json` for JSON. Replace the example item IDs with
current tracker IDs. The command is read-only, works without Git, and never fetches
PR transcripts, invokes test commands, or writes a request journal.

```ts
import { reviewEvidenceRequests } from 'pm-review';
import type { EvidenceRequestInput } from 'pm-review';

const input: EvidenceRequestInput = {
  schema: 'review-requests/v1',
  select: [{ item: 'sample-task', obligation: 'AC1', missing: 'test' }],
  arrivals: [],
  budget: { requests: 8, characters: 8192 },
};
const result = await reviewEvidenceRequests(client, input, 'json');
// Use 'toon' for TOON accounting; serializeEvidenceRequests(result, format)
// returns the exact wire representation the selected budget measures.
```

Each selection names one unresolved `ReviewFinding` (`obligation: "finding"`) or
one current criterion gap (`AC1`, `AC2`, ...), and exactly one missing evidence type:
`source` or `test`. Criterion identifiers and gap states come from `review coverage`.
Status registry roles decide terminal lifecycle state, including custom statuses.
Resolved or withdrawn findings, terminal obligations, reviewed criteria, foreign
item types, unknown criteria and unavailable audited items have explicit skip reasons.
Empty selections produce an empty queue. This is review-specific acquisition;
pm-context's next-evidence planner still owns general acquisition optimization.

Requests include the obligation text (first 240 Unicode code points, with the exact
omitted source UTF-8 byte count), current SDK history version, evidence kind, source path/line when
the finding supplies them, and an instruction requesting **one artifact**. A source
path longer than 256 code units produces a skip reason. No full review body appears
in the output. The SHA-256 request key binds the selection, target history version
and complete SDK item state, including native fields, body and relationships. Even
restoring identical content at a later revision produces a different key.

## Explicit arrivals

Record the focused source excerpt or test artifact in an evidence item's description
through the normal pm SDK or CLI. Link the source with `pm files`, or the focused
test with `pm test --add`. Then add an explicit arrival to the packet:

```json
{
  "request": "<64-character request key from the current queue>",
  "item": "sample-evidence",
  "version": 3,
  "field": "tests",
  "index": 0
}
```

`index` is zero-based within that native collection. Use `files` for source requests
and `tests` for test requests. Supply the evidence item's durable version from
`pm history sample-evidence --compact`. A source link must match the requested path
when one is known. A test link needs a command or path. The description must contain
the declared artifact. An unrelated link, free-form success comment, green check,
wrong artifact kind, absent evidence or stale source revision cannot satisfy a
request. Unmatched old request keys are reported as `request_not_current`.

Only an explicit matching arrival removes a live request from the pending queue;
the `satisfied` receipt retains its request key and evidence version. Editing the
target produces a new obligation revision and invalidates old arrival keys. Editing
or replaying the evidence item invalidates its old arrival version. If the obligation
itself is retired or ceases to be a gap, it is reported as skipped rather than as
satisfied. JSON/CRLF packet replay never writes or restores native tracker state.

Arrival means a caller explicitly supplied a native artifact locator and description.
It does not authenticate that description, read the linked file, execute the test,
or prove the obligation. `approval` always remains `unverified`; use closeout to
verify completion independently. No automatic semantic matching or transcript
summarization occurs.

## Budgets, consistency and validation

The one strict boundary accepts exactly the example packet's keys. Both arrays are
dense, at most 64 entries, and unique by selection triple/request key. IDs are
1–200 ASCII letters/digits/underscores/hyphens beginning with a letter or digit;
criterion numbers are 1–999999. Versions are positive safe integers; arrival indices
are 0–4095. `requests` and `characters` are nonnegative safe integers, including zero
and large ceilings. Unknown keys, fractional/non-finite numbers and sparse arrays are
refused before SDK access. File input is regular UTF-8 JSON, at most 1 MiB.

The queue is a deterministic prefix in selection order, with exact omitted keys and
`request_limit` or `character_limit` reasons. The legacy `characters` field and
budget key measure **actual UTF-8 wire bytes in the selected format**, including
the size field itself, all escaping, counts, and omission metadata. JSON is compact;
TOON uses the SDK encoder. Neither encoding adds a trailing newline. CLI output is
emitted unchanged using SDK host-output suppression. SDK callers select the format
with the optional third argument (default `json`) and use
`serializeEvidenceRequests(result)` to retrieve the cached, measured wire bytes.
Explicitly requesting another encoding or serializing a cloned result yields the
SDK refusal `output_encoding_mismatch`; rerun acquisition in the desired encoding.

One finalizer builds each complete candidate, serializes it, measures it, and
shrinks until both limits hold. Successful results are deeply frozen. If even
the smallest legal prefix envelope cannot fit, `budget_too_small` returns
`minimum: { characters }` for that request ceiling and encoding.
Retrying at the minimum fits; one byte below refuses. Every reported row count
is derived from returned collections. All emitted numbers must be nonnegative
safe integers; invalid native numeric metadata yields `output_invalid`.
See the [budget audit and call-site inventory](output-budget-audit.md).

The SDK verifies history and compares full native current/historical projections.
Two observation passes recheck all referenced items, evidence revisions, criterion
gap states and status definitions. A detected peer change yields `state_changed`.
`consistency: "observed"` describes those observations; it is not a distributed
transaction or an exclusive snapshot. Changes after the last read belong to the
next request. There are no leases, shared budgets, promotions, retry journals or
request writes to race or recover. Unavailable or foreign individual records are
skipped or rejected. An unreadable coverage corpus produces `coverage_unavailable`;
restore readable audited inputs before retrying that criterion. Registry/backend
setup failures retain native SDK errors.

| Refusal | Remedy |
| --- | --- |
| `input_invalid` | Use the strict schema and documented bounds. |
| `file_unavailable` | Supply a regular UTF-8 JSON packet up to 1 MiB. |
| `state_changed` | Re-read current tracker state and retry. |
| `budget_too_small` | Raise the character budget or select fewer obligations. |
| `output_invalid` | Correct unsafe numeric metadata and retry. |

Typed refusals include remedies; the CLI exits nonzero. Per-selection skips and
per-arrival rejections remain visible in an otherwise successful queue.
