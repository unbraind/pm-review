# Changelog

## 2026.10.12 - 2026-10-12

### Added

- Record verdicts and apply replay-safe thread actions ([pm-review-verdict](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-verdict.toon))
- Typed GitHub transport and recorded public fixtures ([pm-review-transport](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-transport.toon))
- Compute exact-head review round completion ([pm-review-round](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-round.toon))
- Scaffold fleet gates and certify packed consumers ([pm-review-quality](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-quality.toon))
- Import every bot thread, review and issue comment idempotently ([pm-review-import](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-import.toon))
- Post recorded verdicts and gate unanswered review work ([pm-review-respond](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-respond.toon))

### Changed

- Adopt pm-github 2026.10.16: default-branch-safe gated sync and daily gated closeout PRs ([pm-review-f82w](https://github.com/unbraind/pm-review/blob/main/.agents/pm/chores/pm-review-f82w.toon))
- Enable the gated pm-github issue sync and remove the braces chain ([pm-review-gated-issue-sync](https://github.com/unbraind/pm-review/blob/main/.agents/pm/chores/pm-review-gated-issue-sync.toon))

### Fixed

- Find durable fix and refusal precedents ([pm-review-precedents](https://github.com/unbraind/pm-review/blob/main/.agents/pm/features/pm-review-precedents.toon))
- Pin the host so history verifies and keep CodeRabbit under the file cap ([pm-review-host-pin](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-host-pin.toon))
- Track development glob dependency advisory before publication ([pm-review-dev-audit](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-dev-audit.toon))
- Prefer the actionable heading over CodeRabbit static-analysis wrapper text ([pm-review-summary-ux](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-summary-ux.toon))
- Close review findings when their source resolves ([pm-review-finding-lifecycle](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-finding-lifecycle.toon))
- Preserve custom ReviewFinding folders in changelog item links ([pm-review-changelog-links](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-changelog-links.toon))
- Linear bot classification, mapped rounds and non-thread voting ([pm-review-round-ux](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-round-ux.toon))
- coderabbitai: Fix the tracking link in the automated release PR body. ([pm-review-gh-300d404ccc6050b4b5da589a](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-300d404ccc6050b4b5da589a.toon))
- Fix repeated extension value placeholders and duplicate help flags ([pm-review-help-ux](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-help-ux.toon))
- Classify Sourcery budget, Sourcery guide and CodeRabbit manual-review notices as informational ([pm-review-pr7r](https://github.com/unbraind/pm-review/blob/main/.agents/pm/issues/pm-review-pr7r.toon))

### Removed

- coderabbitai: Remove the timed-reply completion criterion. ([pm-review-gh-b8d0ce4233d43151b6ae2029](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-b8d0ce4233d43151b6ae2029.toon))

### Security

- github-advanced-security: You are seeing this message because GitHub Code Scanning has recently been set up for this repository, or this pull request contains the workflow file for the Code Scanning tool. ([pm-review-gh-f2f579d4b6d672c020c36332](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-f2f579d4b6d672c020c36332.toon))
- github-advanced-security: CodeQL / Polynomial regular expression used on uncontrolled data ([pm-review-gh-91c81475a10045016ff3d2fe](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-91c81475a10045016ff3d2fe.toon))
- github-advanced-security: CodeQL / Incomplete multi-character sanitization ([pm-review-gh-e42de0001e8f08c535d7dff8](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-e42de0001e8f08c535d7dff8.toon))
- github-advanced-security: CodeQL / Polynomial regular expression used on uncontrolled data ([pm-review-gh-fcc4fe2547554c06f3402e3c](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-fcc4fe2547554c06f3402e3c.toon))

### Other

- Durable bot review context and exact-head round gates ([pm-review-epic](https://github.com/unbraind/pm-review/blob/main/.agents/pm/epics/pm-review-epic.toon))
- Characterize the canonical attestation refusal in the release review-thread loop ([pm-review-release-scanner-blocker](https://github.com/unbraind/pm-review/blob/main/.agents/pm/tasks/pm-review-release-scanner-blocker.toon))
- coderabbitai: Actionable comments posted: 8 ([pm-review-gh-62f3c6c9f2d29d92515c6046](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-62f3c6c9f2d29d92515c6046.toon))
- coderabbitai: Actionable comments posted: 4 ([pm-review-gh-62994f50a613b4005c178d77](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-62994f50a613b4005c178d77.toon))
- coderabbitai: Summary by CodeRabbit ([pm-review-gh-b0d87dd071a6a4f0cff46215](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-b0d87dd071a6a4f0cff46215.toon))
- coderabbitai: ✅ Action performed ([pm-review-gh-5e614f78db4d44b38d159bdc](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-5e614f78db4d44b38d159bdc.toon))
- coderabbitai: ✅ Action performed ([pm-review-gh-5401fc1422f7e46f3479fd80](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-5401fc1422f7e46f3479fd80.toon))
- coderabbitai: Do not use `committedDate` as proof that a reply came after the head. ([pm-review-gh-aca6c43075af8d69f4fb9a9b](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-aca6c43075af8d69f4fb9a9b.toon))
- coderabbitai: Do not mark review bodies with outside-diff findings as `informational`. ([pm-review-gh-080f2180d3733dfb2533e992](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-080f2180d3733dfb2533e992.toon))
- coderabbitai: Keep the event loop alive in the timeout test. ([pm-review-gh-4fe7132133cc04f1d104a05c](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-4fe7132133cc04f1d104a05c.toon))
- coderabbitai: Enforce the identity baseline in a required CI check. ([pm-review-gh-90f7c5234969bd35da36bb39](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-90f7c5234969bd35da36bb39.toon))
- coderabbitai: Keep the search directory visible to the exception. ([pm-review-gh-2c5d13c400035aff589849a2](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-2c5d13c400035aff589849a2.toon))
- coderabbitai: Handle a repository-root source entry before building the include pattern. ([pm-review-gh-33c714f8e3cfe97db7eb821d](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-33c714f8e3cfe97db7eb821d.toon))
- coderabbitai: Reject `--apply` for the `pending` verdict. ([pm-review-gh-93684c3be62cabcfe63f51fc](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-93684c3be62cabcfe63f51fc.toon))
- coderabbitai: Parse the pack manifest after npm 10 prepare output. ([pm-review-gh-77f0ef9d8d9a0823cf38c1a4](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-77f0ef9d8d9a0823cf38c1a4.toon))
- coderabbitai: Raise the `execFileSync` output limit for patch reads. ([pm-review-gh-ba23afc402641b64f22d341a](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-ba23afc402641b64f22d341a.toon))
- coderabbitai: Resolve the root argument before using it. ([pm-review-gh-3756aee5638da26537c52013](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-3756aee5638da26537c52013.toon))
- sourcery-ai: Pull request larger than review limit ([pm-review-gh-28697439f32d9689fa28611d](https://github.com/unbraind/pm-review/blob/main/.agents/pm/review-findings/pm-review-gh-28697439f32d9689fa28611d.toon))
