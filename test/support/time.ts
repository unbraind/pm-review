/** Scale operational watchdogs for slow runners without changing product assertions. */
export function testTime(milliseconds: number): number {
  const scale = Number(process.env.PM_TEST_TIME_SCALE ?? '1');
  const timeout = Math.ceil(milliseconds * scale);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new Error('PM_TEST_TIME_SCALE must produce a positive safe-integer timeout within the timer range');
  }
  return timeout;
}
