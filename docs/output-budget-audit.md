# Final output budget audit

`src/output-budget.ts:finalizeReviewOutput` is the single enforcement point for
caller-budgeted transport output. It constructs a candidate with final omission
reasons, derives counts from its actual collections, serializes the selected
encoding, and measures UTF-8 bytes including the `characters` field itself.
It repeats with fewer requests until the final serialized candidate fits both
limits. Returned successful results are deeply frozen. Nothing adds fields or
framing after the last measurement.

When no legal prefix envelope fits, `budget_too_small` includes
`minimum: { characters }`. The byte minimum is measured across the
legal prefix envelopes for that request ceiling and format. Repeating the request
at the minimum fits; one byte below does not. Omission receipts are retained.

| Call site | Enforcement and emission |
| --- | --- |
| `reviewEvidenceRequests(client, packet, format?)` | Builds obligations, arrivals and diagnostics, then returns only through the finalizer. Default encoding: compact JSON. |
| `reviewEvidenceRequestsFile(client, file, format?)` | Reads the bounded input packet and delegates to the same SDK operation. |
| `pm review requests --file packet.json [--json]` | Chooses JSON/TOON before finalization, writes `serializeEvidenceRequests` verbatim, and uses SDK output suppression to prevent host reformatting, receipts or a trailing newline. Process exit control stays outside the measured payload. |
| `serializeEvidenceRequests(result, format?)` | Returns the cached measured compact JSON/SDK TOON bytes without added framing; defaults to the finalized encoding and refuses a different encoding or a cloned budget result. |

The legacy `characters` field and budget key now mean **UTF-8 wire bytes** in
the chosen format. This includes escaping, multibyte text, all counts, all
omission reasons and all protocol metadata. Request ceilings are applied to the
actual emitted request collection. Budgets are nonnegative safe integers,
including zero and large ceilings; malformed inputs retain typed input refusals.
Excerpts retain at most 240 Unicode code points, and `text_omitted` measures the
actual omitted source UTF-8 bytes.

Audit searches (repository-relative):

```sh
rg -n 'budget|max-|characters|tokens|limit|sizeRequest' src index.ts manifest.json
rg -n 'slice\(|substring|\.length [><=]|max[A-Z_]|limit|budget' src index.ts manifest.json
```

The request packet's `characters` and `requests` are the package's only
caller-controlled output ceilings. There are no package-owned token or `--max-*`
output options. The compact round line is an unbudgeted summary. Findings' stored
summary/title caps, source-path/excerpt caps, and envelope/scope validators bound
stored or input fields; they do not claim to bound a serialized response. File/HTTP
artifact caps, Git subprocess `maxBuffer`, and closeout stdout/time limits protect
input capture and process resources. They remain at their existing boundaries.
No second transport-budget check remains in request acquisition or CLI adapters.

Regression coverage includes the original 297-to-299 byte reason expansion,
500 seeded random output models and 9,663 JSON/TOON boundary budgets: exact fit,
fit minus/plus one, below the minimal envelope, zero, and the largest safe integer.
The invariant checks actual independently encoded UTF-8 bytes, every reported
size/count, request ceilings, immutable results and exact refusal minima. Real
non-git SDK/file/CLI comparisons cover multibyte findings, artifacts, skips,
rejected arrivals and both formats. Packed npm/Bun acceptance checks the actual
CLI process output, including the absence of post-measurement framing.
