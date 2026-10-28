# GitHub issue identity and delivery evidence

The scheduled issue sync runs pm-github's atomic, gated import. A top-level
`gh:owner/repo#N` tag declares unique import/upsert ownership. Use it for the one
PM item tracking that GitHub issue; a URL in prose does not establish identity.

Several PM items can be delivered by the same pull request. Record that shared
relationship as `delivery:owner/repo#N` and retain the PR link in the delivery or
closure evidence. A delivery tag is descriptive and does not claim importer
ownership. The sync skips pull requests by default.

PR [#46](https://github.com/unbraind/pm-review/pull/46) delivered both
`pm-review-bun-closeout-copy` and `pm-review-targeted-evidence-requests`.
Both retain their IDs, closed status, completion dates and closure evidence.
Their former duplicate import tags are replaced by delivery tags through normal
PM mutations; existing history remains an unchanged prefix of each stream.
Neither item is arbitrarily chosen as the import owner of that shared PR.

Before publication, preview the complete import:

```sh
pm github import unbraind/pm-review --state all --atomic --gate --dry-run --with-comments
```

`test/tracker-identity.test.ts` checks every status in the complete tracked
corpus for unique importer tags and preserves the shared delivery regression.
The external importer remains responsible for planning and privacy checks.
Validate apply and repeat behavior in a disposable tracker before publishing
imported changes; successful provenance validation alone is not a privacy,
health or publication receipt.

The pinned importer's privacy rule also flags the public Linux documentation
strings `/proc` and `/proc/` in issue #56. The repository's
`.pm-github-gate-allowlist.json` reviews exactly those two content hashes, with
reasons. These exemptions contain no account, host or concrete PID. They do not
match arbitrary procfs paths or other sensitive content. Atomic, provenance and
privacy gates remain enabled; re-review any future exemption independently.
The upstream classification is tracked in
[pm-github #193](https://github.com/unbraind/pm-github/issues/193).
