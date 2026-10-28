import { readFileSync } from 'node:fs';

/** Process operations are injectable so disappearance interleavings are deterministic. */
export interface ProcessOperations { read: (path: string) => string; signal: (pid: number) => void }

/** Read Linux process metadata without retaining private command lines. */
function readProcessFile(path: string): string { return readFileSync(path, 'utf8'); }

/** Send the deadline's unconditional termination signal. */
function signalProcess(pid: number): void { process.kill(pid, 'SIGKILL'); }

const localOperations: ProcessOperations = { read: readProcessFile, signal: signalProcess };

/** Both kernel outcomes mean that an enumerated process has already disappeared. */
export function processDisappeared(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH');
}

/** A missing process or zombie is terminated; unrelated probe failures remain errors. */
export function processTerminated(pid: number, read: ProcessOperations['read'] = readProcessFile): boolean {
  try {
    const stat = read(`/proc/${pid}/stat`);
    return stat.slice(stat.lastIndexOf(')') + 1).startsWith(' Z ');
  }
  catch (error) { if (processDisappeared(error)) return true; throw error; }
}

/** Kill descendants and groups, attempting remaining cleanup even after unrelated errors. */
export function killProcessTree(pid: number, operations: ProcessOperations = localOperations): boolean {
  let cleaned = true;
  try {
    const children = operations.read(`/proc/${pid}/task/${pid}/children`).trim();
    for (const child of children.split(/\s+/).filter(Boolean)) {
      if (!killProcessTree(Number(child), operations)) cleaned = false;
    }
  } catch (error) { if (!processDisappeared(error)) cleaned = false; }
  try { operations.signal(-pid); }
  catch (error) {
    if (!processDisappeared(error)) cleaned = false;
    // ESRCH for a group does not prove its identically numbered PID is absent.
    try { operations.signal(pid); }
    catch (failure) { if (!processDisappeared(failure)) cleaned = false; }
  }
  return cleaned;
}
