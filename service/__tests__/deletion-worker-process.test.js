/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { runDeletionWorker } from "./deletion-worker-process.test-helpers.js";

const helper = new URL("./deletion-worker-process.test-helpers.js", import.meta.url).href;
const sourceArgs = (source) => ["--input-type=module", "--eval", source];

test("deletion worker starts its operation after preparation and preserves exit evidence", async () => {
  const source = `
    import { waitForDeletionStart } from ${JSON.stringify(helper)};
    await waitForDeletionStart();
    console.log('operation reached');
    process.exit(45);
  `;
  const { termination, output } = await runDeletionWorker(sourceArgs(source), {});
  assert.deepEqual(termination, [45, null]);
  assert.match(output, /operation reached/);
});

test("deletion worker rejects an exit before readiness with its diagnostic output", async () => {
  await assert.rejects(
    runDeletionWorker(sourceArgs("console.error('setup failed'); process.exit(7);"), {}),
    /exited before ready: \[7,null\][\s\S]*setup failed/,
  );
});

test("deletion worker kills a process that never completes preparation", async () => {
  await assert.rejects(
    runDeletionWorker(
      sourceArgs("setInterval(() => {}, 1000);"),
      {},
      { startupMs: 100, operationMs: 10000 },
    ),
    /timed out during startup/,
  );
});

test("deletion worker keeps a separate deadline for a stalled operation", async () => {
  const source = `
    import { waitForDeletionStart } from ${JSON.stringify(helper)};
    await waitForDeletionStart();
    console.log('operation stalled');
    setInterval(() => {}, 1000);
  `;
  await assert.rejects(
    runDeletionWorker(sourceArgs(source), {}, { startupMs: 60000, operationMs: 100 }),
    /timed out during deletion[\s\S]*operation stalled/,
  );
});
