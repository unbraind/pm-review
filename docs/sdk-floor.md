# Published pm SDK capability floor

Audited main: `74073af95d72f352b48547841d406c57f0307a4d`. Required API floor: **2026.8.18**.

Declared host floor: `2026.10.13`. npm peer: `>=2026.10.13`.

floor verified: the host declaration and the npm peer or exact runtime dependency already cover every API below. No floor change is needed.

## Artifact method and limits

The published version list was obtained with `npm view @unbrained/pm-cli versions --json`. Each capability was bisected over stable published releases, with its first providing release and adjacent previous stable release inspected. Prereleases do not satisfy these stable npm minimum ranges. Tarballs were downloaded with `npm pack @unbrained/pm-cli@VERSION --ignore-scripts` into an isolated scratch directory and inspected as data. No downloaded pm package code or lifecycle script was executed.

Public module exports were checked against both `package.json` entrypoints and the static ESM runtime export graph, then their `dist` declarations. Client methods and context members were read from the published declarations, including inherited members and static methods. A context property is attributed to the context used by this package, rather than a later base-interface refactor. TypeScript symbol resolution covers aliases, typed lazy loaders, destructuring, and clients passed through helpers. Erased interfaces do not create runtime requirements; imported function/constructor types used by loaders are retained conservatively.

This establishes API availability. It does not attest older-host runtime semantics, provider integration, or execution on the declared minimum. The current pinned SDK remains the local test host.

## API to first-version table

The machine-readable source inventory and artifact hashes are in [sdk-floor.json](sdk-floor.json). Source locations refer to the audited main commit.

| Used API | First stable release | Previous stable release lacking it | Source uses |
| --- | --- | --- | --- |
| `@unbrained/pm-cli/sdk :: createPmCliExpectedError` | 2026.6.5 | 2026.5.31 | [src/tracker.ts:2](../src/tracker.ts#L2), [src/verdict.ts:2](../src/verdict.ts#L2), [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: EXIT_CODE` | 2026.5.14 | 2026.5.12 | [src/coverage.ts:2](../src/coverage.ts#L2) |
| `@unbrained/pm-cli/sdk :: isPmCliExpectedError` | 2026.6.5 | 2026.5.31 | [src/coverage.ts:2](../src/coverage.ts#L2), [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: isRuntimeRecord` | 2026.8.2 | 2026.8.1 | [src/scope-state.ts:2](../src/scope-state.ts#L2) |
| `@unbrained/pm-cli/sdk :: PmClient` | 2026.7.6 | 2026.7.5 | [src/closeout-run.ts:7](../src/closeout-run.ts#L7), [src/closeout.ts:3](../src/closeout.ts#L3), [src/lineage.ts:3](../src/lineage.ts#L3), [src/tracker.ts:2](../src/tracker.ts#L2), [src/envelopes.ts:2](../src/envelopes.ts#L2), [src/envelope-artifact.ts:4](../src/envelope-artifact.ts#L4), [src/scope-state.ts:3](../src/scope-state.ts#L3), [src/scope.ts:1](../src/scope.ts#L1), [src/scope-file.ts:1](../src/scope-file.ts#L1), [src/coverage.ts:3](../src/coverage.ts#L3), [src/reconcile.ts:1](../src/reconcile.ts#L1), [src/verdict.ts:2](../src/verdict.ts#L2), [src/respond.ts:2](../src/respond.ts#L2), [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: PmCliError` | 2026.5.14 | 2026.5.12 | [src/scope-state.ts:2](../src/scope-state.ts#L2) |
| `@unbrained/pm-cli/sdk :: printResult` | 2026.7.23 | 2026.7.22 | [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: readBooleanOption` | 2026.5.27 | 2026.5.24 | [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: readStringOption` | 2026.5.27 | 2026.5.24 | [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk :: scoreItemSimilarity` | 2026.7.25 | 2026.7.24 | [src/lineage.ts:2](../src/lineage.ts#L2) |
| `@unbrained/pm-cli/sdk :: splitAcceptanceCriteria` | 2026.7.23 | 2026.7.22 | [src/closeout.ts:1](../src/closeout.ts#L1), [src/scope-state.ts:2](../src/scope-state.ts#L2), [src/coverage.ts:2](../src/coverage.ts#L2) |
| `@unbrained/pm-cli/sdk :: suppressHostOutput` | 2026.7.15 | 2026.7.14 | [src/commands.ts:3](../src/commands.ts#L3) |
| `@unbrained/pm-cli/sdk/authoring :: defineCommand` | 2026.7.26 | 2026.7.25 | [src/commands.ts:4](../src/commands.ts#L4) |
| `@unbrained/pm-cli/sdk/authoring :: defineExtension` | 2026.7.26 | 2026.7.25 | [index.ts:13](../index.ts#L13) |
| `CommandHandlerContext.args` | 2026.5.1 | 2026.3.12 | [src/commands.ts:50](../src/commands.ts#L50), [src/commands.ts:58](../src/commands.ts#L58), [src/commands.ts:62](../src/commands.ts#L62), [src/commands.ts:69](../src/commands.ts#L69), [src/commands.ts:82](../src/commands.ts#L82), [src/commands.ts:83](../src/commands.ts#L83), [src/commands.ts:88](../src/commands.ts#L88) |
| `CommandHandlerContext.command` | 2026.5.1 | 2026.3.12 | [src/commands.ts:49](../src/commands.ts#L49), [src/commands.ts:50](../src/commands.ts#L50), [src/commands.ts:53](../src/commands.ts#L53), [src/commands.ts:57](../src/commands.ts#L57), [src/commands.ts:61](../src/commands.ts#L61), [src/commands.ts:64](../src/commands.ts#L64), [src/commands.ts:67](../src/commands.ts#L67), [src/commands.ts:75](../src/commands.ts#L75), [src/commands.ts:79](../src/commands.ts#L79), [src/commands.ts:85](../src/commands.ts#L85), [src/commands.ts:92](../src/commands.ts#L92), [src/commands.ts:94](../src/commands.ts#L94), [src/commands.ts:96](../src/commands.ts#L96), [src/commands.ts:98](../src/commands.ts#L98), [src/commands.ts:99](../src/commands.ts#L99) |
| `CommandHandlerContext.global` | 2026.5.1 | 2026.3.12 | [src/commands.ts:48](../src/commands.ts#L48), [src/commands.ts:63](../src/commands.ts#L63), [src/commands.ts:102](../src/commands.ts#L102), [src/commands.ts:103](../src/commands.ts#L103) |
| `CommandHandlerContext.options` | 2026.5.1 | 2026.3.12 | [src/commands.ts:50](../src/commands.ts#L50), [src/commands.ts:54](../src/commands.ts#L54), [src/commands.ts:58](../src/commands.ts#L58), [src/commands.ts:63](../src/commands.ts#L63), [src/commands.ts:68](../src/commands.ts#L68), [src/commands.ts:69](../src/commands.ts#L69), [src/commands.ts:76](../src/commands.ts#L76), [src/commands.ts:80](../src/commands.ts#L80), [src/commands.ts:81](../src/commands.ts#L81), [src/commands.ts:86](../src/commands.ts#L86), [src/commands.ts:87](../src/commands.ts#L87), [src/commands.ts:88](../src/commands.ts#L88), [src/commands.ts:90](../src/commands.ts#L90), [src/commands.ts:93](../src/commands.ts#L93), [src/commands.ts:96](../src/commands.ts#L96), [src/commands.ts:102](../src/commands.ts#L102) |
| `CommandHandlerContext.pm_root` | 2026.5.1 | 2026.3.12 | [src/commands.ts:48](../src/commands.ts#L48), [src/commands.ts:69](../src/commands.ts#L69) |
| `CommandHandlerContext.repo_root` | 2026.7.25 | 2026.7.24 | [src/commands.ts:48](../src/commands.ts#L48), [src/commands.ts:69](../src/commands.ts#L69) |
| `CommandHandlerContext.sdk` | 2026.7.19 | 2026.7.18 | [src/commands.ts:48](../src/commands.ts#L48) |
| `CommandHandlerContext.source_workspace_root` | 2026.7.25 | 2026.7.24 | [src/commands.ts:48](../src/commands.ts#L48), [src/commands.ts:69](../src/commands.ts#L69) |
| `ExtensionApi.registerCommand` | 2026.5.1 | 2026.3.12 | [src/commands.ts:141](../src/commands.ts#L141) |
| `ExtensionApi.registerItemFields` | 2026.5.1 | 2026.3.12 | [index.ts:58](../index.ts#L58) |
| `ExtensionApi.registerItemTypes` | 2026.5.1 | 2026.3.12 | [index.ts:57](../index.ts#L57) |
| `ExtensionCommandSdk.client` | 2026.7.19 | 2026.7.18 | [src/commands.ts:48](../src/commands.ts#L48) |
| `PmClient.close` | 2026.7.6 | 2026.7.5 | [src/tracker.ts:139](../src/tracker.ts#L139) |
| `PmClient.comments` | 2026.7.9 | 2026.7.8 | [src/lineage.ts:72](../src/lineage.ts#L72), [src/coverage.ts:123](../src/coverage.ts#L123) |
| `PmClient.create` | 2026.7.6 | 2026.7.5 | [src/tracker.ts:79](../src/tracker.ts#L79), [src/envelopes.ts:33](../src/envelopes.ts#L33) |
| `PmClient.get` | 2026.7.6 | 2026.7.5 | [src/closeout-run.ts:122](../src/closeout-run.ts#L122), [src/closeout.ts:86](../src/closeout.ts#L86), [src/scope-state.ts:50](../src/scope-state.ts#L50), [src/scope-state.ts:63](../src/scope-state.ts#L63), [src/scope.ts:31](../src/scope.ts#L31), [src/coverage.ts:75](../src/coverage.ts#L75), [src/coverage.ts:112](../src/coverage.ts#L112) |
| `PmClient.listAllComplete` | 2026.8.18 | 2026.8.17 | [src/lineage.ts:42](../src/lineage.ts#L42), [src/envelopes.ts:24](../src/envelopes.ts#L24), [src/envelopes.ts:37](../src/envelopes.ts#L37), [src/coverage.ts:80](../src/coverage.ts#L80) |
| `PmClient.schemaAddField` | 2026.7.9 | 2026.7.8 | [src/tracker.ts:36](../src/tracker.ts#L36) |
| `PmClient.schemaAddType` | 2026.7.9 | 2026.7.8 | [src/tracker.ts:30](../src/tracker.ts#L30) |
| `PmClient.schemaList` | 2026.7.9 | 2026.7.8 | [src/tracker.ts:28](../src/tracker.ts#L28) |
| `PmClient.schemaListFields` | 2026.7.9 | 2026.7.8 | [src/tracker.ts:32](../src/tracker.ts#L32) |
| `PmClient.update` | 2026.7.6 | 2026.7.5 | [src/tracker.ts:75](../src/tracker.ts#L75), [src/tracker.ts:86](../src/tracker.ts#L86), [src/tracker.ts:92](../src/tracker.ts#L92), [src/tracker.ts:115](../src/tracker.ts#L115), [src/tracker.ts:135](../src/tracker.ts#L135), [src/verdict.ts:86](../src/verdict.ts#L86) |
| `PmCliErrorContext.valid_range` | 2026.7.15 | 2026.7.14 | [src/scope-state.ts:66](../src/scope-state.ts#L66) |

## Tarball provenance

SHA-256 of the exact packed `.tgz` bytes; package archives and extracted files are not committed.

| pm release | Tarball SHA-256 |
| --- | --- |
| 2026.3.12 | `4e4e6a33cb45d665f072120e9e1ce25d2e5773e738cbc914b29e8f54367747fb` |
| 2026.5.1 | `730de8b79aa0074dc2ca81a54ce37f9aaa0a4167b690c9a62b87d2121a8b37f7` |
| 2026.5.12 | `42dcaef84dc441b7792aeffa059bfe10a86ae8b12b1084472229bba03fb29910` |
| 2026.5.14 | `7f7e9131afadb891344bf2fb93b15bc157d18c532a5da4ec31677957d37b7260` |
| 2026.5.24 | `9d28fff4b06405ea5691ee919ad646c86c0a416a5007ca8104b19251306262af` |
| 2026.5.27 | `afd3c6e0ecca429510f049019069802c0034a3e99fb711035b5b22fc8fa643dd` |
| 2026.5.31 | `d3b4a795704588e414070a22a4034d7fbd7a290a050509cc4852e0051c0969a7` |
| 2026.6.5 | `bb47c85bb2ce1a8ba858651af8d1f4ca6888bc731d0aaaa63a4b97427219cd89` |
| 2026.7.5 | `4a6664f68120cace5648faf48d51b08c14e969d9c7e185e592f1a0fceae57274` |
| 2026.7.6 | `0d6e446cf93a0f0660ce4e21943adf1e0c21381010ef67369f40cc9834b8d158` |
| 2026.7.8 | `b892cce02e555decd3f0d09af0d2a5d8817494fe577e357ffaea84ef385a9b6a` |
| 2026.7.9 | `87600f77a82d5e66c8ac05f120b435a0fb22b5fad42ae5db4540bb4ca45a01ea` |
| 2026.7.14 | `4a42de258a3b1cabff1112dd90ae4f3cc272e25ada229d818becae0f2845e128` |
| 2026.7.15 | `1c5d8e7427d74af157577ff58e0692a986016ee355eaf3a6b5ccebca5a9779aa` |
| 2026.7.18 | `44b48fe680cf330254a4ab8d42b55cbcee81ba5cf21e4d4550b40413265d64b9` |
| 2026.7.19 | `513e0aead42767a113a26b8b2e2cbb8a22879d0cb0500d4d3cdd16d21d9f7a39` |
| 2026.7.22 | `d013832d6afc97c9a5c6f4a48a497f54a216643f8c7017b9c4f807ce6607532b` |
| 2026.7.23 | `caf1a21b0b587dc55c3509654466dd1e20383e30f2d17b47678887a15a5490af` |
| 2026.7.24 | `ae7757c7e4b02bf5c0908a7bcfd487926912bc2f71332c68c9e1be4017d796ab` |
| 2026.7.25 | `20dfec2ca4ddfcebd484af686b76aebcb1f479a7b81c781380a7fe6b6f8506f5` |
| 2026.7.26 | `b10b647a7fce423106dfb964934ac2d43b8770f8f085df89a13c9a04e75569cc` |
| 2026.8.1 | `242013e81ed2c4329a3cb20d3e70fa58f6dbb627d00c2c1e883562e786850f80` |
| 2026.8.2 | `c9f8e516319ba4d6609ea0272e4fa70360668531c379ec54b29df8aa418293e3` |
| 2026.8.17 | `fda330eb4887031751889ef85b510d52886fa5f70b4813f3951d7eed705023f2` |
| 2026.8.18 | `b00374f0e32c98ccec03a5893d8bfbbae45650f44bd04292ceafd8d9aac059f7` |
