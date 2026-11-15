/** Scale operational watchdogs for slow runners without changing product assertions. */
export function testTime(milliseconds: number): number {
  const scale = Number(process.env.PM_TEST_TIME_SCALE ?? '1');
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(milliseconds * scale)) {
    throw new Error('PM_TEST_TIME_SCALE must produce a positive safe-integer timeout');
  }
  return milliseconds * scale;
}
