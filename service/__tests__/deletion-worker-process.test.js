/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { inspect } from "node:util";
import { isProcessAlive } from "@noobot/platform-compatibility/process";
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

test(
  "deletion worker cancellation waits for its descendants to exit",
  { timeout: 15000 },
  async (t) => {
    const controller = new AbortController();
    const reason = new Error("deletion cancelled by caller");
    let descendantPid;
    const server = createServer((req, res) => {
      descendantPid = Number(req.url.slice(1));
      res.end();
      controller.abort(reason);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));
    t.after(async () => {
      if (isProcessAlive(descendantPid)) {
        process.kill(descendantPid, "SIGKILL");
      }
    });
    const source = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { get } from 'node:http';
    import { waitForDeletionStart } from ${JSON.stringify(helper)};
    await waitForDeletionStart();
    const descendant = spawn(process.execPath, ['-e', 'process.send(process.pid); setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true
    });
    const [pid] = await once(descendant, 'message');
    get('http://127.0.0.1:${server.address().port}/' + pid, res => res.resume()).on('error', () => {});
  `;
    await assert.rejects(
      runDeletionWorker(sourceArgs(source), { signal: controller.signal }),
      (error) => {
        assert.equal(error, reason, inspect(error, { depth: null }));
        return true;
      },
    );
    assert.ok(descendantPid > 0);
    assert.throws(() => process.kill(descendantPid, 0), { code: "ESRCH" });
  },
);

test("deletion worker rejects cancellation before spawning", async () => {
  const reason = new Error("already cancelled");
  await assert.rejects(runDeletionWorker([], { signal: AbortSignal.abort(reason) }), reason);
});
