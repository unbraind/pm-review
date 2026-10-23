import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createExtensionCommandSdk } from '@unbrained/pm-cli/sdk';
import { activateExtensionForTest, runRegisteredCommandForTest } from '@unbrained/pm-cli/sdk/testing';
import extension, { importEvidenceEnvelope, importReviewArtifact } from '../index.ts';
import type { EnvelopeCode, EnvelopeResult, EnvelopeReceipt } from '../index.ts';
import { validateEnvelope } from '../src/envelope-validation.ts';
import { ensureReviewSchema, fieldOptions, recordVerdict, reviewItems } from '../src/tracker.ts';
import { evaluateRound } from '../src/round.ts';
import { coverCriterion, reviewCoverage } from '../src/coverage.ts';
import type { CoverageMap } from '../src/coverage-types.ts';
import { envelope } from './envelope-fixture.ts';
import { inFixtureWorkspace, pullRequest, tracker } from './helpers.ts';

/** Require a stable code and an actionable remedy without provider text leakage. */
function denied(result: EnvelopeResult, code: EnvelopeCode): void {
  assert.equal(result.ok, false);
  assert.equal((result as { refusal: { code: string } }).refusal.code, code);
  assert.ok((result as { refusal: { remedy: string } }).refusal.remedy.length > 20);
}

/** Pin exactly the bytes presented by a synthetic artifact, rather than parsed JSON. */
function digest(bytes: string): string { return createHash('sha256').update(bytes).digest('hex'); }

test('envelopes deduplicate immutable revisions, preserve local decisions, and isolate provider namespaces', async t => {
  const { client } = await tracker(t);
  const input = envelope();
  const first = await importEvidenceEnvelope(client, input) as EnvelopeReceipt;
  assert.equal(first.created, 2);
  assert.equal(first.completion, 'unverified');
  const original = (await reviewItems(client)).find(row => row.id === first.items[0].id)!;
  await recordVerdict(client, original, 'refuse', 'The input boundary is intentionally described in the companion contract', '');
  const before = JSON.stringify((await client.listAllComplete()).items);
  const replay = await importEvidenceEnvelope(client, { findings: [...input.findings].reverse(), provenance: input.provenance, source: { ...input.source }, version: 1 }) as EnvelopeReceipt;
  assert.equal(replay.created, 0);
  assert.equal(replay.reused, 2);
  assert.equal(JSON.stringify((await client.listAllComplete()).items), before, 'exact replay changes no item or history');
  assert.equal((await reviewItems(client)).find(row => row.id === original.id)!.review_verdict, 'refuse');
  denied(await importEvidenceEnvelope(client, { ...input, findings: input.findings.map(row => ({ ...row, body: row.body + ' Changed.' })) }), 'identity_conflict');
  assert.equal(JSON.stringify((await client.listAllComplete()).items), before, 'conflict refuses before writes');
  const revised = await importEvidenceEnvelope(client, { ...input, source: { ...input.source, revision: 'doc-v4' } }) as EnvelopeReceipt;
  assert.equal(revised.created, 2);
  for (const source of [{ ...input.source, provider: 'other-provider' }, { ...input.source, origin: 'https://other.example.org', url: 'https://other.example.org/42' }, { ...input.source, artifact: 'review-43' }]) {
    assert.equal((await importEvidenceEnvelope(client, { ...input, source }) as EnvelopeReceipt).created, 2);
  }
  const items = await reviewItems(client);
  assert.equal(items.length, 10);
  assert.deepEqual([...new Set(items.map(row => row.review_head))].sort(), ['doc-v3', 'doc-v4']);
  assert.ok(items.every(row => row.review_head_source === 'envelope' && row.review_provenance === 'declared'));
  assert.equal(items.find(row => row.review_summary === input.findings[0].summary)!.review_line, 12);
  assert.equal(items.find(row => row.review_summary === input.findings[1].summary)!.review_line, 0);
});

test('unsupported provenance and forged completion assertions cannot establish review completion or criterion coverage', async t => {
  const { client } = await tracker(t);
  const input = envelope();
  for (const provenance of [{ kind: 'signed' }, { kind: 'github' }, { kind: 'declared', completed: true }]) denied(await importEvidenceEnvelope(client, { ...input, provenance }), 'provenance_unsupported');
  denied(await importEvidenceEnvelope(client, { ...input, completed: true }), 'envelope_invalid');
  assert.equal((await client.listAllComplete()).items.length, 0);
  input.source.reviewer = 'coderabbitai[bot]';
  input.source.revision = 'a'.repeat(40);
  input.source.origin = 'https://github.com';
  input.source.url = 'https://github.com/example/package/pull/1#pullrequestreview-1';
  const result = await importEvidenceEnvelope(client, input) as EnvelopeReceipt;
  const pr = pullRequest({ reviews: [], comments: [], threads: [] });
  assert.equal(evaluateRound(pr, await reviewItems(client)).coderabbit_finished, false);
  const target = (await client.create({ title: 'Publish the API contract', acceptanceCriteria: 'Document invalid input responses' })).item;
  const map = await reviewCoverage(client, target.id) as CoverageMap;
  const coverage = await coverCriterion(client, target.id, { revision: map.revision, criterion: 'AC1', evidence: result.items[0].id, excerpt: input.findings[0].body, judgment: 'reviewed', reason: 'Review discusses the error contract' });
  assert.equal(coverage.ok, false);
});

test('malformed envelopes refuse atomically with bounded bodies, complete identities and distinct finding ids', async t => {
  const { client } = await tracker(t);
  const base = envelope();
  const invalid: unknown[] = [null, [], 1, {}, { ...base, version: 2 }, { ...base, source: null }, { ...base, provenance: [] }, { ...base, findings: null },
    { ...base, source: { ...base.source, provider: 'Invalid Provider' } }, { ...base, source: { ...base.source, artifact: '' } }, { ...base, source: { ...base.source, revision: ' padded ' } },
    { ...base, source: { ...base.source, reviewer: 42 } }, { ...base, source: { ...base.source, subject: '\n' } }, { ...base, source: { ...base.source, subject: 'x'.repeat(2049) } },
    { ...base, source: { ...base.source, extra: 'ignored' } }, { ...base, source: { ...base.source, origin: 'invalid' } },
    ...['http://reviews.example.org', 'https://reviews.example.org/', 'https://user:secret@reviews.example.org'].map(origin => ({ ...base, source: { ...base.source, origin } })),
    ...['http://reviews.example.org/42', 'https://other.example.org/42', 'https://user:secret@reviews.example.org/42', 'https://:secret@reviews.example.org/42', 'invalid'].map(url => ({ ...base, source: { ...base.source, url } })),
    ...[[], Array(51).fill(base.findings[0]), [null], [1], [{ ...base.findings[0], id: '' }], [{ ...base.findings[0], summary: '' }], [{ ...base.findings[0], body: 1 }], [{ ...base.findings[0], body: ' ' }], [{ ...base.findings[0], body: 'x'.repeat(16001) }], [{ ...base.findings[0], path: '' }], [{ ...base.findings[0], line: 1.5 }], [{ ...base.findings[0], line: 0 }], [{ ...base.findings[0], complete: true }], [base.findings[0], base.findings[0]]].map(findings => ({ ...base, findings }))];
  for (const value of invalid) denied(await importEvidenceEnvelope(client, value), 'envelope_invalid');
  assert.equal((await client.listAllComplete()).items.length, 0);
  assert.ok(!('ok' in validateEnvelope(base)));
});

test('digest-pinned local files and synthetic HTTP share identities and reject partial, redirected or oversized artifacts', async t => {
  const { client, cwd } = await tracker(t);
  const bytes = JSON.stringify(envelope());
  const file = join(cwd, 'review.json');
  await writeFile(file, bytes);
  const first = await importReviewArtifact(client, { file, sha256: digest(bytes) }) as EnvelopeReceipt;
  assert.equal(first.created, 2);
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/review' }); res.end(); }
    else if (req.url === '/missing') { res.writeHead(404); res.end(); }
    else if (req.url === '/large') { res.end('x'.repeat(1024 * 1024 + 1)); }
    else if (req.url === '/partial') { res.writeHead(200, { 'content-length': bytes.length + 100 }); res.end(bytes); }
    else res.end(bytes);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const replay = await importReviewArtifact(client, { url: url + '/review', sha256: digest(bytes) }) as EnvelopeReceipt;
  assert.equal(replay.reused, 2);
  assert.deepEqual(replay.items, first.items);
  for (const suffix of ['/missing', '/redirect', '/partial']) denied(await importReviewArtifact(client, { url: url + suffix, sha256: digest(bytes) }), 'artifact_unavailable');
  denied(await importReviewArtifact(client, { url: url + '/large', sha256: digest(bytes) }), 'artifact_too_large');
  for (const input of [{ sha256: digest(bytes) }, { file, url, sha256: digest(bytes) }, { file, sha256: 'invalid' }, { file: '', sha256: digest(bytes) }, ...['ftp://example.org/file', 'invalid', 'https://user:secret@example.org', 'https://:secret@example.org'].map(url => ({ url, sha256: digest(bytes) }))]) denied(await importReviewArtifact(client, input), 'input_invalid');
  denied(await importReviewArtifact(client, { file: cwd, sha256: digest(bytes) }), 'artifact_unavailable');
  denied(await importReviewArtifact(client, { file: join(cwd, 'absent'), sha256: digest(bytes) }), 'artifact_unavailable');
  denied(await importReviewArtifact(client, { file, sha256: '0'.repeat(64) }), 'digest_mismatch');
  await writeFile(file, '{');
  denied(await importReviewArtifact(client, { file, sha256: digest('{') }), 'envelope_invalid');
  await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
  denied(await importReviewArtifact(client, { file, sha256: digest('large') }), 'artifact_too_large');
  // A native empty 200 Response is legal for injectable fetch implementations.
  t.mock.method(globalThis, 'fetch', async () => new Response(null));
  denied(await importReviewArtifact(client, { url, sha256: digest(bytes) }), 'artifact_unavailable');
  t.mock.restoreAll();
});

test('registered ingest CLI gives compact receipts and typed refusals without GitHub coordinates', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const file = join(cwd, 'review.json');
  const bytes = JSON.stringify(envelope());
  await writeFile(file, bytes);
  const sdk = createExtensionCommandSdk(pmRoot, client, 'test-agent');
  const { commands, failed } = await activateExtensionForTest(extension, { name: 'pm-review', capabilities: ['schema', 'commands'] });
  assert.equal(failed.length, 0);
  const success = await runRegisteredCommandForTest(commands, { command: 'review ingest', args: [], options: { file, sha256: digest(bytes) }, pmRoot, sdk });
  assert.equal((success.result as EnvelopeReceipt).created, 2);
  assert.equal((success.result as { exit_code?: number }).exit_code, undefined);
  const failure = await runRegisteredCommandForTest(commands, { command: 'review ingest', args: [], options: {}, pmRoot, sdk });
  denied(failure.result as EnvelopeResult, 'input_invalid');
  assert.equal((failure.result as { exit_code: number }).exit_code, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(success.result)) < 1000);
  assert.ok(!JSON.stringify(success.result).includes(envelope().findings[0].body));
});

/** Capture a real host process asynchronously so HTTP servers can still serve requests. */
async function host(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '../node_modules/@unbrained/pm-cli/dist/cli.js'), ...args], { cwd, env });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}

test('real host imports without a git executable in a plain tracker and renders TOON and JSON', async t => {
  const { client, cwd, pmRoot } = await tracker(t);
  const source = join(cwd, 'package-source');
  await mkdir(source);
  await cp(join(import.meta.dirname, '../dist'), join(source, 'dist'), { recursive: true });
  for (const file of ['package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) await writeFile(join(source, file), await readFile(join(import.meta.dirname, '..', file)));
  await inFixtureWorkspace(cwd, () => client.packageInstall(source, { project: true }));
  const bin = join(cwd, 'bin');
  await mkdir(bin);
  await symlink(process.execPath, join(bin, 'node'));
  const file = join(cwd, 'review.json');
  const bytes = JSON.stringify(envelope());
  await writeFile(file, bytes);
  const env = { ...process.env, PATH: bin, GIT_CEILING_DIRECTORIES: dirname(cwd), PM_AUTHOR: 'test-agent', PM_SOURCE_WORKSPACE_ROOT: cwd };
  const args = ['--path', pmRoot, 'review', 'ingest', '--file', file, '--sha256', digest(bytes)];
  const json = await host(cwd, [...args, '--json'], env);
  assert.equal(json.code, 0, json.output);
  assert.equal((JSON.parse(json.output) as EnvelopeReceipt).created, 2);
  const toon = await host(cwd, args, env);
  assert.equal(toon.code, 0, toon.output);
  assert.match(toon.output, /reused: 2/);
  assert.match(toon.output, /completion:.*unverified/);
  assert.ok(Buffer.byteLength(toon.output) < 1000);
  const refused = await host(cwd, ['--path', pmRoot, 'review', 'ingest', '--json'], env);
  assert.equal(refused.code, 1, refused.output);
  assert.equal(JSON.parse(refused.output).refusal.code, 'input_invalid');
});

test('deterministic ids refuse an occupied task instead of overwriting it', async t => {
  for (const prefix of ['sample', 'ev']) {
  const { client } = await tracker(t, prefix);
  const input = envelope();
  const scope = digest(JSON.stringify([input.source.provider, input.source.origin, input.source.artifact, input.source.revision]));
  const id = 'ev-' + digest(JSON.stringify([scope, input.findings[0].id])).slice(0, 32);
  await client.create({ id, title: 'An unrelated task occupies a deterministic identity' });
  denied(await importEvidenceEnvelope(client, input), 'identity_conflict');
  assert.equal((await client.listAllComplete()).items.length, 1);
  }
});

test('native SDK locking deduplicates concurrent imports', async t => {
  const { client } = await tracker(t);
  await ensureReviewSchema(client);
  const results = await Promise.all([importEvidenceEnvelope(client, envelope()), importEvidenceEnvelope(client, envelope())]);
  assert.ok(results.every(row => row.ok), JSON.stringify(results));
  assert.equal((await client.listAllComplete()).items.length, 2);
  assert.equal(results.reduce((sum, row) => sum + (row as EnvelopeReceipt).created, 0), 2);
  const first = (await client.listAllComplete()).items[0];
  await client.update(first.id, fieldOptions({ review_artifact_digest: 'changed' }));
  denied(await importEvidenceEnvelope(client, envelope()), 'identity_conflict');
});

test('subsets of an artifact replay independently and concurrent conflicting observations fail closed', async t => {
  const { client } = await tracker(t);
  await ensureReviewSchema(client);
  const input = envelope();
  const left = { ...input, findings: [input.findings[0]] };
  const right = { ...input, findings: [{ ...input.findings[0], body: 'A conflicting observation for the same immutable source revision.' }] };
  const results = await Promise.all([importEvidenceEnvelope(client, left), importEvidenceEnvelope(client, right)]);
  assert.equal(results.filter(row => row.ok).length, 1);
  denied(results.find(row => !row.ok)!, 'identity_conflict');
  assert.equal((await client.listAllComplete()).items.length, 1);
  const second = await importEvidenceEnvelope(client, { ...input, findings: [input.findings[1]] }) as EnvelopeReceipt;
  assert.equal(second.created, 1);
});

test('SDK governance failures retain the original refusal and do not masquerade as identity conflicts', async t => {
  const { client } = await tracker(t);
  await ensureReviewSchema(client);
  const input = envelope();
  const first = input.findings[0];
  await client.create({ title: `${input.source.reviewer}: ${first.summary}`, description: first.body, type: 'ReviewFinding' });
  await client.config('project', 'set', 'governance.duplicate_detection_mode', 'strict');
  await assert.rejects(importEvidenceEnvelope(client, { ...input, findings: [first] }), /duplicate|similar/i);
  assert.equal((await client.listAllComplete()).items.length, 1);
});
