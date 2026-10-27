import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk, decodeToon, encodeToon, isHostOutputSuppressed } from '@unbrained/pm-cli/sdk';
import type { SuppressedHostOutput } from '@unbrained/pm-cli/sdk';
import { reviewEvidenceRequests, reviewEvidenceRequestsFile } from '../src/requests.ts';
import { runReviewCommand } from '../src/commands.ts';
import { fieldOptions } from '../src/tracker.ts';
import { requestsFixture } from './requests-fixture.ts';
import type { EvidenceOutputFormat, EvidenceRequestInput, EvidenceRequestResult } from '../src/requests-types.ts';

test('real non-git SDK/file/CLI JSON and TOON outputs obey boundary budgets after artifacts, skips and reasons change', async t => {
  const { client, finding, gap, evidence, packet, pmRoot, cwd } = await requestsFixture(t);
  let state = 0x51b01026; let comparisons = 0;
  const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state; };
  const file = join(cwd, 'budget-packet.json');
  for (let trial = 0; trial < 3; trial++) {
    await client.update(finding, fieldOptions({ review_summary: ['é🧪漢字', 'quote " slash \\ newline\n', 'short'][next() % 3].repeat(1 + next() % 35) }));
    const input: EvidenceRequestInput = { ...packet, select: trial === 0 ? [packet.select[0]] : [packet.select[0], { item: gap, obligation: 'finding', missing: 'test' }], arrivals: trial === 2 ? [{ request: 'f'.repeat(64), item: evidence, version: 1, field: 'tests', index: 0 }] : [] };
    for (const format of ['json', 'toon'] as const) {
      const full = await reviewEvidenceRequests(client, input, format);
      assert.equal(full.ok, true);
      const minimal = await reviewEvidenceRequests(client, { ...input, budget: { requests: 1, characters: 0 } }, format);
      assert.equal(minimal.ok, false);
      if (minimal.ok || !minimal.minimum) assert.fail('Expected exact minimum');
      const min = minimal.minimum.characters;
      if (!full.ok) assert.fail('Expected full result');
      const budgets = new Set([0, 297, min - 1, min, min + 1, full.characters - 1, full.characters, full.characters + 1, Number.MAX_SAFE_INTEGER]);
      for (const characters of budgets) {
        const value = { ...input, budget: { requests: 1, characters } };
        await writeFile(file, JSON.stringify(value, null, 2).replaceAll('\n', '\r\n'));
        const result = await reviewEvidenceRequests(client, value, format);
        assert.deepEqual(await reviewEvidenceRequestsFile(client, file, format), result);
        let stdout = '';
        const capture = t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => { stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(); return true; });
        let handled: SuppressedHostOutput<EvidenceRequestResult> & { exit_code?: number };
        try {
          handled = await runReviewCommand({ command: 'review requests', args: [], options: { file }, global: { json: format === 'json' }, repo_root: cwd, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') }) as typeof handled;
        } finally { capture.mock.restore(); }
        assert.ok(isHostOutputSuppressed(handled));
        assert.deepEqual(handled.result, result);
        const decoded = format === 'json' ? JSON.parse(stdout) : decodeToon(stdout);
        assert.deepEqual(decoded, result);
        assert.equal(stdout, format === 'json' ? JSON.stringify(result) : encodeToon(result));
        if (result.ok) {
          assert.ok(Buffer.byteLength(stdout) <= characters);
          assert.equal(result.characters, Buffer.byteLength(stdout));
          assert.equal(handled.exit_code, undefined);
        } else {
          assert.equal(result.refusal.code, 'budget_too_small');
          assert.equal(result.minimum?.characters, min);
          assert.equal(handled.exit_code, 1);
        }
        comparisons++;
      }
    }
  }
  const empty = await reviewEvidenceRequests(client, { ...packet, select: [], arrivals: [], budget: { requests: Number.MAX_SAFE_INTEGER, characters: Number.MAX_SAFE_INTEGER } });
  assert.equal(empty.ok, true);
  t.diagnostic(`seed=0x51b01026; ${comparisons} real SDK/file/CLI comparisons; exact stdout bytes, UTF-8 Unicode, minima and both formats`);
});

test('invalid SDK encodings refuse at the single boundary', async t => {
  const { client, packet, cwd, pmRoot } = await requestsFixture(t);
  const result = await reviewEvidenceRequests(client, packet, 'xml' as EvidenceOutputFormat);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.code, 'input_invalid');
  const file = join(cwd, 'explicit-format.json');
  await writeFile(file, JSON.stringify(packet));
  const expected = await reviewEvidenceRequests(client, packet);
  for (const settings of [{ outputFormat: 'json' }, { defaultOutputFormat: 'json' }] as const) {
    const command = await runReviewCommand({ command: 'review requests', args: [], options: { file }, global: { quiet: true, ...settings }, repo_root: cwd, pm_root: pmRoot, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') }) as SuppressedHostOutput;
    assert.deepEqual(command.result, expected);
  }
});
