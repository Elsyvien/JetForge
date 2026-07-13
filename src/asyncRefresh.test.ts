import assert from "node:assert/strict";
import { CoalescingAsyncRefresh } from "./asyncRefresh";

async function run(): Promise<void> {
  const invalidations: boolean[] = [];
  const refresh = new CoalescingAsyncRefresh(async (invalidate) => {
    invalidations.push(invalidate);
    return true;
  }, 5);

  const burst = await Promise.all([
    refresh.request(false),
    refresh.request(true),
    refresh.request(false)
  ]);
  assert.deepEqual(burst, [true, true, true]);
  assert.deepEqual(invalidations, [true]);

  let releaseFirst: (() => void) | undefined;
  const started: boolean[] = [];
  const overlapping = new CoalescingAsyncRefresh(async (invalidate) => {
    started.push(invalidate);
    if (started.length === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return true;
  }, 0);
  const first = overlapping.request(false, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = overlapping.request(true, true);
  releaseFirst?.();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(started, [false, true]);

  const disposed = new CoalescingAsyncRefresh(async () => true, 50);
  const pending = disposed.request();
  disposed.dispose();
  assert.equal(await pending, false);

  const failing = new CoalescingAsyncRefresh(async () => {
    throw new Error("refresh failed");
  }, 0);
  assert.equal(await failing.request(false, true), false);
  refresh.dispose();
  overlapping.dispose();
  failing.dispose();
}

run().then(
  () => console.log("async refresh tests ok"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
