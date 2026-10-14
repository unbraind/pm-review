import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { REVIEW_TYPE } from '../src/tracker.ts';
import { isMainInvocation } from './main-invocation.ts';

/** Correct the pinned generator's pluralization using the package-owned custom type folder. */
export function canonicalFindingLinks(markdown: string, itemUrlBase: string): string {
  const base = itemUrlBase.replace(/\/$/, '');
  return markdown.replaceAll(`${base}/${REVIEW_TYPE.name.toLowerCase()}s/`, `${base}/${REVIEW_TYPE.folder}/`);
}

/** Read the last configured option, including the generator's equals spelling. */
function optionValue(args: string[], name: string, fallback: string): string {
  let value = fallback;
  for (const [index, arg] of args.entries()) {
    if (arg === name) value = args[index + 1];
    else if (arg.startsWith(`${name}=`)) value = arg.slice(name.length + 1);
  }
  return value;
}

/** Capture stdout through a file descriptor so full history never hits a pipe buffer cap. */
function generateChangelog(args: string[], cwd: string): string | null {
  const scratch = mkdtempSync(join(tmpdir(), 'pm-review-changelog-'));
  const output = join(scratch, 'output.md');
  const fd = openSync(output, 'w');
  try {
    const generated = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('pm-changelog/cli'), ...args, '--stdout'], { cwd, stdio: ['ignore', fd, 'inherit'] });
    return generated.status === 0 ? readFileSync(output, 'utf8') : null;
  } finally {
    closeSync(fd);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Generate before comparing or publishing, validating every local tracker link against this branch. */
export function runChangelog(args: string[], cwd = process.cwd()): number {
  const check = args.includes('--check');
  const stepSummary = args.includes('--github-step-summary');
  const forwarded = args.filter(arg => arg !== '--check' && arg !== '--github-step-summary');
  const generated = generateChangelog(forwarded, cwd);
  if (generated === null) return 1;
  const base = optionValue(args, '--item-url-base', '').replace(/\/$/, '');
  const markdown = base ? canonicalFindingLinks(generated, base) : generated;
  const pmRoot = resolve(cwd, optionValue(args, '--pm-root', '.agents/pm'));
  for (const match of markdown.matchAll(/\]\(([^)\s]+\.toon)\)/g)) {
    if (!base || !match[1].startsWith(`${base}/`)) continue;
    const itemPath = match[1].slice(base.length + 1);
    if (!existsSync(resolve(pmRoot, itemPath))) throw new Error(`Changelog item link has no branch file: ${itemPath}`);
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
