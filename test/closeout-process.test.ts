import assert from 'node:assert/strict';
import { test } from 'node:test';
import { killProcessTree, processDisappeared, processTerminated } from '../src/closeout-process.ts';
import type { ProcessOperations } from '../src/closeout-process.ts';
import { boundedHost } from '../src/closeout-run.ts';

/** Model errno outcomes without generating real processes or signalling arbitrary PIDs. */
function errno(code: string): Error { return Object.assign(new Error('fixture'), { code }); }

for (const code of ['ENOENT', 'ESRCH']) {
  for (const boundary of ['enumerate', 'signal-group', 'signal-pid']) {
    test(`deadline accepts ${code} when a child disappears at ${boundary}`, () => {
      let alive = true;
      const signals: number[] = [];
      const operations: ProcessOperations = {
        read(path) {
          if (path === '/proc/101/task/101/children') {
            // Enumeration has captured the child, which can disappear before traversal.
            if (boundary === 'enumerate') alive = false;
            return '102 103';
          }
          if (path === '/proc/102/task/102/children' && !alive) throw errno(code);
          return '';
        },
        signal(pid) {
          signals.push(pid);
          if (pid === -102) {
            if (boundary === 'signal-group') alive = false;
            throw errno(code); // A non-leader child need not have its own group.
          }
          if (pid === 102) {
            if (boundary === 'signal-pid') alive = false;
            if (!alive) throw errno(code);
            alive = false;
          }
        },
      };
      assert.equal(killProcessTree(101, operations), true);
      assert.equal(alive, false);
      assert.deepEqual(signals, [-102, 102, -103, -101]);
    });
  }

  test(`deadline stat observation accepts disappearance with ${code}`, () => {
    const captured = [102]; // The enumerated child disappears immediately before its stat read.
    assert.equal(processTerminated(captured[0], () => { throw errno(code); }), true);
  });
}

test('deadline liveness distinguishes zombies, live children and unrelated reader errors', () => {
  assert.equal(processTerminated(102, () => '102 (fixture) Z 1'), true);
  assert.equal(processTerminated(102, () => '102 (fixture) S 1'), false);
  assert.equal(processTerminated(102, () => '102 (fixture ) Z misleading) S 1'), false);
  assert.equal(processTerminated(process.pid), false);
  for (const code of ['EACCES', 'EPERM', 'EIO']) {
    const failure = errno(code);
    assert.throws(() => processTerminated(102, () => { throw failure; }), error => error === failure);
  }
  for (const failure of [null, undefined, 'ESRCH', 3, {}, { code: 'EACCES' }]) assert.equal(processDisappeared(failure), false);
});

test('missing process groups still require PID termination for a live non-leader child', () => {
  const signals: number[] = [];
  assert.equal(killProcessTree(102, {
    read: () => '',
    signal(pid) { signals.push(pid); if (pid < 0) throw errno('ESRCH'); },
  }), true);
  assert.deepEqual(signals, [-102, 102]);
});

test('unrelated enumeration and signal errors fail cleanup while remaining descendants are attempted', () => {
  for (const boundary of ['enumerate', 'signal-group', 'signal-pid']) {
    for (const code of ['EACCES', 'EPERM', 'EIO']) {
      const signals: number[] = [];
      assert.equal(killProcessTree(101, {
        read(path) {
          if (path === '/proc/101/task/101/children') return '102 103';
          if (path === '/proc/102/task/102/children' && boundary === 'enumerate') throw errno(code);
          return '';
        },
        signal(pid) {
          signals.push(pid);
          if (pid === -102 && boundary !== 'enumerate') throw errno(boundary === 'signal-group' ? code : 'ESRCH');
          if (pid === 102 && boundary === 'signal-pid') throw errno(code);
        },
      }), false);
      assert.ok(signals.includes(-103));
      assert.equal(signals.at(-1), -101);
    }
  }
});

test('cleanup refusal blocks parseable successful host evidence', async () => {
  const execution = await boundedHost(['-e', 'console.log(JSON.stringify({run_results:[]}))'], process.cwd(), 10_000, () => false);
  assert.deepEqual(execution, { runs: [], error: 'Closeout process cleanup failed' });
});

test('host spawn failure has no PID to signal and remains a bounded refusal', async () => {
  const execution = await boundedHost(['-e', ''], 'missing-closeout-fixture-directory', 10_000, () => assert.fail('no PID was spawned'));
  assert.deepEqual(execution, { runs: [], error: 'Pinned test host could not start' });
});
