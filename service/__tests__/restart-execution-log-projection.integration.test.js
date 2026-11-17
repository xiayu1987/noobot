/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setFsAdapter, resetFsAdapter } from "noobot-agent/store";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { requireExecutionProjectionSourceId } from "@noobot/session-protocol";
import { openRestartProjectionSession as openSession } from "./restart-execution-log-projection.test-helpers.js";
import {
  initializeUserRuntimeDirectories,
  sessionDirPath,
  withRuntimeEventsRoot,
} from "./runtime-events-root.test-helpers.js";

const userId = "restart-user";
const sessionId = "restart-session";
const dialogProcessId = "completed-dialog";
const now = () => "2026-11-15T00:00:00.000Z";

async function recoverInNewProcess(workspaceRoot, query) {
  const source = `
    import { openRestartProjectionSession } from ${JSON.stringify(new URL("./restart-execution-log-projection.test-helpers.js", import.meta.url).href)};
    import { recoverServiceRestartTurns } from ${JSON.stringify(new URL("../bootstrap/recover-service-restart-turns.js", import.meta.url).href)};
    import { withRuntimeEventsEnv } from "@noobot/runtime-events/testing";
    import { flushJsonLineBatches } from "@noobot/runtime-events";
    const [workspaceRoot, query] = JSON.parse(process.argv[1]);
    await withRuntimeEventsEnv({ workspaceRoot }, async () => {
      const session = openRestartProjectionSession(workspaceRoot);
      const progress = [];
      const result = await recoverServiceRestartTurns({
        bot: { session }, userId: query.userId,
        onProgress: (item) => progress.push(item),
      });
      const logs = await session.getExecutionTurnLogs(query);
      await flushJsonLineBatches();
      process.stdout.write(JSON.stringify({ result, logs, progress, pid: process.pid }));
    });
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      new URL("../../shared/testing/runtime-params.js", import.meta.url).href,
      "--input-type=module",
      "-e",
      source,
      JSON.stringify([workspaceRoot, query]),
    ],
    { timeout: 30000 },
  );
  return JSON.parse(stdout);
}

for (const failedPublication of ["runtime-output", "projection-cursor"]) {
  test(`service restart recovers an idle session after ${failedPublication} failure through the real facade`, async () => {
    await withRuntimeEventsRoot("noobot-restart-projection-", async (workspaceRoot) => {
      await initializeUserRuntimeDirectories(workspaceRoot, userId);
      const session = openSession(workspaceRoot);
      await session.createSession({
        userId,
        sessionId,
        parentSessionId: "",
        caller: SESSION_CALLER.USER,
        persistenceScope: null,
      });
      const failure = new Error(`interrupted ${failedPublication}`);
      const output = path.join(
        await sessionDirPath(workspaceRoot, userId, sessionId),
        "events",
        "interaction.jsonl",
      );
      if (failedPublication === "runtime-output") await mkdir(output, { recursive: true });
      setFsAdapter({
        async rename(source, destination) {
          if (
            failedPublication === "projection-cursor" &&
            destination.endsWith("projection-cursor.json")
          )
            throw failure;
          return rename(source, destination);
        },
      });
      try {
        await assert.rejects(
          session.appendExecutionLog({
            userId,
            sessionId,
            dialogProcessId,
            turnScopeId: "finished-turn",
            persistenceScope: null,
            event: "tool_call_start",
            category: "tool",
            type: "tool_call",
            data: { tool: "read_file" },
            ts: now(),
          }),
          (error) =>
            error.code === "EXECUTION_LOG_PROJECTION_FAILED" &&
            (failedPublication === "projection-cursor"
              ? error.cause === failure
              : error.cause instanceof TypeError &&
                error.cause.message === `Runtime event target is not a file: ${output}`),
        );
      } finally {
        resetFsAdapter();
        if (failedPublication === "runtime-output") await rm(output, { recursive: true });
      }
      const query = { userId, sessionId, dialogProcessId, persistenceScope: null };
      const original = await session.getExecutionTurnLogs(query);
      assert.equal(original.length, 1);
      const restarted = await recoverInNewProcess(workspaceRoot, query);
      assert.notEqual(restarted.pid, process.pid);
      assert.deepEqual(restarted.result, {
        recoveredSessionIds: [],
        failures: [],
      });
      assert.deepEqual(
        restarted.progress,
        [],
        "idle sessions recover projections without a lifecycle mutation",
      );
      assert.deepEqual(restarted.logs, original, "recovery never reappends authoritative logs");
      const bytes = await readFile(output, "utf8");
      const events = bytes.trim().split("\n").map(JSON.parse);
      assert.equal(
        events.length,
        1,
        "the durable output receipt prevents duplicate delivery after a cursor failure",
      );
      assert.equal(
        requireExecutionProjectionSourceId(events[0].data.executionLogSourceId)[0],
        dialogProcessId,
      );
      const secondRestart = await recoverInNewProcess(workspaceRoot, query);
      assert.notEqual(secondRestart.pid, restarted.pid);
      assert.deepEqual(secondRestart.result, {
        recoveredSessionIds: [],
        failures: [],
      });
      assert.equal(
        await readFile(output, "utf8"),
        bytes,
        "a durable cursor prevents another delivery",
      );
    });
  });
}
