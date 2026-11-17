# Passing test output and closeout evidence

SDK/CLI 2026.11.14 intentionally trims quiet passing CLI test streams to six
lines and 480 characters. Its
[release notes](https://github.com/unbraind/pm-cli/releases/tag/v2026.11.14)
prescribe `--full-output` for scripts parsing complete test streams. This
changes the CLI projection; the SDK still returns complete streams.

[Job 133920462791](https://github.com/unbraind/pm-review/actions/runs/44048614366/job/133920462791)
reports `execution_missing` even though the linked command passed. The TAP
assertions occur before the final summary and disappear from the quiet tail.
Tracker discovery, Git-root ceilings and symlink resolution are not the cause.

Identical `npx -y @unbrained/pm-cli@VERSION --no-extensions --json --pm-path
.agents/pm test fixture-proof --run` commands against a fresh plain tracker
with twelve named Node tests produce:

| Version / option | Command status | Named assertions in stdout |
| --- | --- | --- |
| 2026.11.13 | passed | 12 |
| 2026.11.14 | passed | 0 |
| 2026.11.14 --full-output | passed | 12 |

The default 2026.11.14 result reports `stdout_omitted_bytes` and an omission
receipt naming `--full-output`. Closeout now requests that flag on hosts from
2026.11.14. Older supported hosts retain their original invocation because
they do not recognize the flag. The new regression requires all twelve fresh
named results, including the first criterion, beyond the quiet tail.
