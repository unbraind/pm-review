import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension from '../index.ts';
import { findingsOf, isReviewNotice } from '../src/findings.ts';
import { evaluateRound } from '../src/round.ts';
import { importFindings, recordVerdict, reviewItems } from '../src/tracker.ts';
import { contribution, pullRequest, tracker } from './helpers.ts';
import { offlineCompletionHost } from './completion-fixture.ts';
import { providerNotices } from './fixtures/provider-notices.ts';

const cases = [
  ...['Quota exhausted', 'No access to this repository', 'Action not completed', 'Failed to generate review', 'This repository does not receive automatic reviews.', 'Review failed', 'Rate-limit exceeded', 'Review skipped', 'Trial ended'].map(body => ({ label: body, body, complete: false })),
  { label: 'rate-limit finding', body: '**High**\nAdd retry backoff for rate-limit responses before writes.', complete: true },
  { label: 'empty submitted review', body: '', complete: true },
  { label: 'no actionable issues', body: 'No actionable issues.', complete: true },
  ...providerNotices.flatMap(notice => [
    { label: `${notice.provider} notice`, body: notice.body, complete: false },
    { label: `${notice.provider} notice alongside substantive finding`, body: `**High**\nValidate input before writes.\n\n${notice.body}`, complete: true },
  ]),
];

for (const scenario of cases) {
  test(`exact-head completion: ${scenario.label}`, async t => {
    const pr = pullRequest({ threads: [], comments: [], reviews: [{ ...contribution({ id: 'completion', body: scenario.body }), state: 'COMMENTED' }] });
    offlineCompletionHost(t, pr);
    const { client, pmRoot } = await tracker(t);
    const imported = await importFindings(client, pr, findingsOf(pr));
    for (const row of imported.items) {
      const item = (await reviewItems(client)).find(item => item.id === row.id)!;
      if (item.review_verdict === 'pending') await recordVerdict(client, item, 'fix', 'Validated input before writes.', 'b'.repeat(40));
    }
    const before = await reviewItems(client);
    const histories = await Promise.all(before.map(item => readFile(join(pmRoot, 'history', `${item.id}.jsonl`), 'utf8')));
    assert.equal(isReviewNotice(scenario.body), !scenario.complete);
    const round = evaluateRound(pr, before);
    assert.deepEqual(round.pending_items, []);
    assert.deepEqual(round.unimported_nodes, []);
    assert.deepEqual(round.unvoted_bot_comments, []);
    assert.equal(round.coderabbit_finished, scenario.complete);
    assert.equal(round.complete, scenario.complete);
    const activation = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['commands', 'schema'] });
    assert.deepEqual(activation.failed, []);
    for (const command of ['review round', 'review status']) {
      const host = await runRegisteredCommandForTest(activation.commands, { command, options: { repo: pr.repo, pr: '1' }, pmRoot, sdk: createExtensionCommandSdk(pmRoot, client, 'test-agent') });
      assert.equal(host.handled, true, JSON.stringify(host));
      assert.deepEqual(host.warnings, []);
      const result = host.result as Record<string, unknown>;
      assert.equal(result.complete, scenario.complete, command);
      assert.equal(result[command === 'review round' ? 'coderabbit_finished' : 'current_head_review_completed'], scenario.complete, command);
      assert.equal(host.exitCode, scenario.complete ? undefined : 1, command);
      if (command === 'review status') {
        for (const key of ['unvoted_bot_items', 'findings_without_verdict', 'verdicts_without_reply', 'stale_replies', 'unresolved_threads']) assert.deepEqual(result[key], [], key);
      }
    }
    assert.deepEqual(await reviewItems(client), before);
    assert.deepEqual(await Promise.all(before.map(item => readFile(join(pmRoot, 'history', `${item.id}.jsonl`), 'utf8'))), histories);
  });
}
