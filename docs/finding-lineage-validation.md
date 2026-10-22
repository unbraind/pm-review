# Public tracker validation

Source: public `unbraind/pm-review`, `origin/main` commit
`51bce9146d77bcf79dec6722eb76363939a67668`.

Export only `.agents/pm` with `git archive`, outside any git repository. Run
`node test/lineage-public-tracker.ts <exported-tracker-root>` with
`GIT_CEILING_DIRECTORIES` set to the scratch parent. The validator performs only
SDK reads and proposals and compares every original durable file before/after.
The source repository and original tracker are never modified.

| Measurement | Result |
| --- | ---: |
| Total public tracker items | 48 |
| Review observations | 22 |
| Review providers | 3 |
| Known source revisions | 2 |
| Canonical dispositions before confirmation | 22 |
| Core duplicate candidate clusters | 4 |
| Review candidate proposals checked | 3 |
| Proposals remaining unconfirmed | 3 of 3 |
| Original durable files unchanged | 102 of 102 |
| Largest compact JSON lineage receipt | 894 bytes |

No real match was confirmed and no real verdict was changed. Synthetic, real-SDK
non-git tracker tests separately verify explicit confirmation, shared verdicts,
conflicting decision refusals, source withdrawal/reappearance and repeat imports.
This measurement establishes read-only compatibility with this public corpus;
it does not claim that lexical candidates are semantically equivalent.
