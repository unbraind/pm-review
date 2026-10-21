import type { CloseoutChange, CloseoutFinding, CloseoutTest } from './closeout-types.ts';

/** Identify test artifacts independently of their linked command spelling. */
export function isTestFile(file: string): boolean { return /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file); }

/** Compare JSON policy leaves; reductions in coverage floors and lint severity fail closed. */
function weakened(before: unknown, after: unknown, key = ''): boolean {
  const severity = new Map<unknown, number>([['error', 2], ['warn', 1], ['off', 0], [2, 2], [1, 1], [0, 0]]);
  if (key.includes('rules') && severity.has(before) && severity.has(after)) return severity.get(after)! < severity.get(before)!;
  if (typeof before === 'number' && typeof after === 'number') return /thresholds|coverage|statements|branches|functions|lines/.test(key) && after < before;
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object') {
    return Object.entries(before).some(/** A removed policy leaf also weakens the gate. */ ([name, value]) => !(name in after) || weakened(value, (after as Record<string, unknown>)[name], `${key}.${name}`));
  }
  return false;
}

/** Detect literal coverage floors in executable configs without evaluating their code. */
function loweredLiteralFloor(before: string, after: string): boolean {
  const pattern = /\b(statements|branches|functions|lines)["']?\s*[:=]\s*(\d+(?:\.\d+)?)/g;
  const current = new Map([...after.matchAll(pattern)].map(/** Keep literal dimensions available for old/new comparison. */ match => [match[1], Number(match[2])]));
  return [...before.matchAll(pattern)].some(/** Missing/dynamic dimensions remain generic policy findings. */ match => current.has(match[1]) && current.get(match[1])! < Number(match[2]));
}

/** Scan changed policies and test definitions conservatively, retaining uncertain policy changes. */
export function detectGaming(changes: CloseoutChange[]): CloseoutFinding[] {
  const findings: CloseoutFinding[] = [];
  for (const change of changes) {
    const { file, before, after } = change;
    if (before === after) continue;
    if (/package\.json$|(?:coverage|eslint|lint|vitest|jest|nyc|c8)[^/]*\.[cm]?[jt]s(?:on)?$/.test(file)) {
      let lowered = loweredLiteralFloor(before ?? '', after ?? '');
      if (before !== null && after !== null && file.endsWith('.json')) {
        try { lowered = weakened(JSON.parse(before), JSON.parse(after)); } catch { /* Non-JSON policies remain reviewable findings below. */ }
      }
      findings.push({ code: lowered ? 'threshold_lowered' : 'gate_changed', file, detail: lowered ? 'A coverage floor or lint rule was weakened or removed' : 'Changed test or lint policy requires independent review' });
    }
    if (!isTestFile(file)) continue;
    if (after === null) { findings.push({ code: 'test_deleted', file, detail: 'Test artifact deleted' }); continue; }
    const priorLines = new Set((before ?? '').split('\n'));
    const addedLines = after.split('\n').filter(/** Compare test directives on newly changed lines, including replacements at equal counts. */ line => !priorLines.has(line)).join('\n');
    for (const [code, pattern] of [['test_skipped', /\.(?:skip|todo)\s*\(|\b(?:skip|todo)\s*:\s*(?!false\b)|\b[x](?:it|test|describe)\s*\(/g], ['test_focused', /\.only\s*\(|\bonly\s*:\s*true|\bf(?:it|describe)\s*\(/g]] as const) {
      if ([...addedLines.matchAll(pattern)].length > 0) findings.push({ code, file, detail: 'New skipped, pending or focused test definition' });
    }
    const testNames = /\b(?:test|it|describe)(?:\.[a-z]+)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const names = new Set([...after.matchAll(testNames)].map(/** Test titles are stable definition evidence. */ match => match[1]));
    for (const match of (before ?? '').matchAll(testNames)) if (!names.has(match[1])) findings.push({ code: 'test_deleted', file, detail: `Removed test: ${match[1]}` });
  }
  return findings;
}

/** Parse named TAP, Node spec and Bun assertions; skip directives override apparent success. */
export function namedTests(stdout: string, command: number): CloseoutTest[] {
  return stdout.split(/\r?\n/).flatMap(/** Summary counters and arbitrary EXIT:0 lines are never named assertions. */ line => {
    const match = /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s*(SKIP|TODO)\b.*)?$/.exec(line);
    if (match) return [{ name: match[2], result: match[3] ? 'skipped' as const : match[1] === 'ok' ? 'passed' as const : 'failed' as const, command }];
    const spec = /^\s*([✔✖✓✗﹣])\s+(.+?)(?:\s+\([\d.]+m?s\)|\s+\[[\d.]+ms\])?(?:\s+#\s*(SKIP|TODO)\b.*)?$/.exec(line);
    return spec ? [{ name: spec[2], result: spec[3] || spec[1] === '﹣' ? 'skipped' as const : ['✔', '✓'].includes(spec[1]) ? 'passed' as const : 'failed' as const, command }] : [];
  });
}
