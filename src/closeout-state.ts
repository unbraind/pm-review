import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ItemMetadata } from '@unbrained/pm-cli/sdk';
import type { CloseoutChange, CloseoutSkip } from './closeout-types.ts';

/** Detect repository metadata without invoking git on a plain tracker. */
export function hasGit(root: string): boolean {
  if (existsSync(resolve(root, '.git'))) return true;
  const parent = dirname(root);
  return parent !== root && hasGit(parent);
}

/** Refuse traversal and symlink artifacts before reading or restoring a linked path. */
export function artifactPath(root: string, file: string): string {
  const target = resolve(root, file);
  const rel = relative(root, target);
  if (!rel || isAbsolute(file) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Linked artifacts must use workspace-relative paths');
  let cursor = target;
  while (cursor !== root) {
    if (lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Linked artifact symlinks are not supported');
    cursor = dirname(cursor);
  }
  return target;
}

/** Read text artifacts with a fixed size ceiling; missing files represent deletions. */
export function artifactText(root: string, file: string): string | null {
  const target = artifactPath(root, file);
  if (!existsSync(target)) return null;
  if (!lstatSync(target).isFile() || lstatSync(target).size > 1_000_000) throw new Error('Linked artifact must be a text file below one megabyte');
  const text = readFileSync(target, 'utf8');
  if (text.includes('\0')) throw new Error('Binary artifacts cannot prove textual closeout evidence');
  return text;
}

/** Execute bounded, argument-only git reads with external diff and text conversions disabled. */
export function readGit(root: string, args: string[]): string {
  return execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Compare the worktree, including uncommitted and untracked files, against a validated base. */
export function closeoutChanges(root: string, item: Pick<ItemMetadata, 'files' | 'docs' | 'acceptance_criteria' | 'comments' | 'tests'>, base: string | undefined, skipped: CloseoutSkip[]): { baseline: string; changes: CloseoutChange[] } {
  if (base !== undefined && hasGit(root)) {
    let commit: string;
    try { commit = readGit(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim(); }
    catch { throw new Error('--base must resolve to a commit in the workspace repository'); }
    if (realpathSync(readGit(root, ['rev-parse', '--show-toplevel']).trim()) !== realpathSync(root)) throw new Error('Run closeout from the repository root');
    const files = new Set([...readGit(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', commit, '--']).split('\0'), ...readGit(root, ['ls-files', '--others', '--exclude-standard', '--exclude=node_modules', '-z']).split('\0')].filter(Boolean));
    const changes = [...files].map(file => {
      let before: string | null = null;
      if (readGit(root, ['ls-tree', '--name-only', commit, '--', file]).trim()) before = readGit(root, ['show', `${commit}:${file}`]);
      return { file, before, after: artifactText(root, file) };
    });
    return { baseline: commit, changes };
  }
  const changes: CloseoutChange[] = [];
  for (const link of [...(item.files ?? []), ...(item.docs ?? [])]) {
    const match = /(?:^|\n)closeout-before:([A-Za-z0-9+/=]+)(?:\n|$)/.exec(link.note ?? '');
    if (match) changes.push({ file: link.path, before: Buffer.from(match[1], 'base64').toString('utf8'), after: artifactText(root, link.path) });
    else skipped.push({ check: `baseline:${link.path}`, reason: 'Linked artifact has no recorded closeout-before state' });
  }
  if (changes.length === 0) skipped.push({ check: 'diff', reason: base === undefined ? 'No --base or recorded linked-file state supplied' : 'No git repository; --base cannot be resolved and no linked-file state is recorded' });
  skipped.push({ check: 'repository-wide-diff', reason: 'Only recorded linked artifacts can be compared without a git base' });
  return { baseline: 'linked-file-state', changes };
}
