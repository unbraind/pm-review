# Independent closeout verification

`pm review closeout <id> --base <commit> --json` reads the item's full acceptance
criteria, linked tests, file/document links and comments, then independently
executes its linked commands using the installed peer PM host. It never closes,
updates, claims or releases the source item. Test-run history belongs to a
disposable tracker copy. The caller needs a local source workspace, including
installed test dependencies.

Each criterion receives `proven`, `unproven` or `contradicted`, with named test
results, a linked file when supplied, and the identifying comment position.
Comments have no native identifiers in the pinned SDK: `comment:1` means the
first entry in its append-only comment collection. Historic success claims are
never treated as fresh runs. An empty criterion list cannot pass.

Bind a criterion to a named test assertion with `[test:exact test title]` in its
acceptance text. Multiple such assertions must all pass. A criterion whose full
text equals a test title also works. For existing prose criteria, record an
explicit mapping as a comment:

```text
closeout AC1: test="rejects invalid input" file="src/input.ts"
```

The file must be linked to that item and present. The comment is a selector,
not proof: the named test must execute now. Unmapped prose stays unproven;
similar words, a passing package command and an old `EXIT:0` are insufficient.
A successful named assertion proves its mapped executable assertion, not the
semantic completeness of an arbitrary natural-language requirement. Reviewers
must assess that correspondence and retain meaningful behavioral tests.

The default total linked-test budget is 60 seconds per execution, configurable
with `--timeout 1..600`. The deadline includes test-host setup and all linked
commands; it overrides even longer per-link timeouts. Output is bounded and
process groups are killed on timeout. Trust refusals, missing commands,
assertion failures, skips and unsupported output remain blocking
findings. Linked-test environment and assertions retain the host semantics.
Commands still have the permissions of the invoking user: a disposable copy is
not an OS security sandbox. Test dependencies are shared read-only by convention
through the copied workspace's dependency link.

Git comparison includes committed, staged, unstaged and untracked changes from
`--base` to the current workspace. Invoke at the repository root. The base is
resolved as a commit without shell interpolation. External diff/textconv are
disabled. Linked artifact paths must stay within the workspace and cannot use
symlinks, binary contents or text larger than one megabyte. Workspace roots are canonicalized before copying,
and artifact symlinks are refused in executable snapshots; installed dependencies
remain the explicit shared-link exception.

Findings include weakened coverage floors/lint severity, changed test policies,
new focused/skipped/pending tests, removed test cases/artifacts, missing runs,
and missing linked files. Policy and test-definition scanning is conservative:
unsupported policy formats and renamed tests require review rather than silently
passing. It does not parse every test framework or dynamic configuration.
Native V8 counters additionally flag changed functions that never execute.
Transpiled or non-V8 code without matching source counters is explicitly
unverified. Invocation alone does not prove an assertion depends on the result.

`--revert-check` runs the same tests again in another disposable copy with only
changed source files restored to the baseline. Keep build steps in the linked
command when tests import generated output. A baseline-passing named assertion
must fail after restoration; build errors, host failures and timeouts are
inconclusive. Passing after restore produces `revert_survived`. Restoring several
functions together proves aggregate sensitivity, not individual necessity.

Named assertions are recognized in TAP, Node spec and Bun output, including stderr.
The CLI emits aggregate test counts while criterion rows retain the relevant names.
The SDK report retains all named test rows.

The result uses the host's default TOON rendering or global `--json`. Exit zero
requires at least one criterion, every criterion proven and no open finding.
The result includes skipped checks and their reasons. Clearing findings means
repairing the code/evidence and rerunning; there is no bypass flag.

## Without git

Closeout reads and executes linked tests in plain trackers as well. Record the
previous UTF-8 contents in each linked file/document note as
`closeout-before:<base64>`. Comparisons use those recorded contents and current
files; the receipt explicitly skips repository-wide diff discovery. Missing
recorded states block closeout. An unavailable `--base` cannot substitute for
recorded state. Git metadata is detected by filesystem inspection before any
Git operation. No source Git checkout is needed for the plain-tracker path.
