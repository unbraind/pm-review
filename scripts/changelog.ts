import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { REVIEW_TYPE } from '../src/tracker.ts';
import { isMainInvocation } from './main-invocation.ts';

/** Canonical public tracker prefix shared by generation and branch-local link validation. */
const ITEM_BASE = 'https://github.com/unbraind/pm-review/blob/main/.agents/pm/';

/** Correct the pinned generator's pluralization using the package-owned custom type folder. */
export function canonicalFindingLinks(markdown: string): string {
  return markdown.replaceAll(`${ITEM_BASE}${REVIEW_TYPE.name.toLowerCase()}s/`, `${ITEM_BASE}${REVIEW_TYPE.folder}/`);
}

/** Generate before comparing or publishing, validating every local tracker link against this branch. */
export function runChangelog(args: string[], cwd = process.cwd()): number {
  const check = args.includes('--check');
  const stepSummary = args.includes('--github-step-summary');
  const forwarded = args.filter(arg => arg !== '--check' && arg !== '--github-step-summary');
  const generated = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('pm-changelog/cli'), ...forwarded, '--stdout'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (generated.status !== 0) return 1;
  const markdown = canonicalFindingLinks(generated.stdout);
  for (const match of markdown.matchAll(/https:\/\/github\.com\/unbraind\/pm-review\/blob\/main\/(\.agents\/pm\/[^)\s]+\.toon)/g)) {
    if (!existsSync(resolve(cwd, match[1]))) throw new Error(`Changelog item link has no branch file: ${match[1]}`);
  }
  if (args.includes('--stdout')) {
    process.stdout.write(markdown);
    if (stepSummary && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    return 0;
  }
  const outputIndex = args.indexOf('--output');
  const output = resolve(cwd, outputIndex === -1 ? 'CHANGELOG.md' : args[outputIndex + 1]);
  if (check) return existsSync(output) && readFileSync(output, 'utf8') === markdown ? 0 : 1;
  writeFileSync(output, markdown);
  return 0;
}

if (isMainInvocation(process.argv, import.meta.url)) process.exitCode = runChangelog(process.argv.slice(2));
