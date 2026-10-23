import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { PmClient } from '@unbrained/pm-cli/sdk';
import { importEvidenceEnvelope } from './envelopes.ts';
import { envelopeRefusal } from './envelope-validation.ts';
import type { EnvelopeInput, EnvelopeResult } from './envelope-types.ts';

/** One artifact is bounded independently of output and finding-count budgets. */
const LIMIT = 1024 * 1024;

/** Read exactly one regular file with a bounded buffer, including concurrent file growth. */
async function fileBytes(file: string): Promise<Buffer | undefined> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('regular file required');
    const bytes = Buffer.alloc(LIMIT + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) return bytes.subarray(0, count);
      count += read.bytesRead;
    }
    return undefined;
  } finally { await handle.close(); }
}

/** Accept explicit HTTP(S) only; never follow redirects or forward host credentials. */
function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch { /* Malformed selectors are typed input refusals. */ }
  return undefined;
}

/** Bound decompressed HTTP bytes as they arrive and release the response on every path. */
async function httpBytes(url: URL): Promise<Buffer | undefined> {
  const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error('complete response required');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return Buffer.concat(chunks);
      size += chunk.value.length;
      if (size > LIMIT) return undefined;
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
}

/** Verify caller-pinned artifact bytes before parsing JSON or touching the tracker. */
export async function importReviewArtifact(client: PmClient, input: EnvelopeInput): Promise<EnvelopeResult> {
  const url = input.url === undefined ? undefined : httpUrl(input.url);
  if ((input.file === undefined) === (input.url === undefined) || !/^[a-f0-9]{64}$/.test(input.sha256) || input.file === '' || (input.url !== undefined && !url)) return envelopeRefusal('input_invalid');
  let bytes: Buffer | undefined;
  try { bytes = input.file === undefined ? await httpBytes(url!) : await fileBytes(input.file); }
  catch { return envelopeRefusal('artifact_unavailable'); }
  if (!bytes) return envelopeRefusal('artifact_too_large');
  if (createHash('sha256').update(bytes).digest('hex') !== input.sha256) return envelopeRefusal('digest_mismatch');
  let envelope: unknown;
  try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return envelopeRefusal('envelope_invalid'); }
  return importEvidenceEnvelope(client, envelope);
}
