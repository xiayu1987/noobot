/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_LAYOUT } from "@noobot/workspace-protocol";
import { EXECUTION_LOG_PROJECTION_CURSOR_FILE } from "@noobot/session-protocol";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { resolveExecutionTurnDir } from "../../src/session/session-artifact-execution-logs.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import {
  persistChildSessionFixture,
  useRuntimeEventsUserWorkspace,
} from "../helpers/runtime-events-env.js";

test("missing registration never acknowledges a projection and restoring it replays the accepted source", async (t) => {
  const workspaceRoot = await useRuntimeEventsUserWorkspace(t, "u1");
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const sessionDir = path.dirname(eventsDir);
  const executionRepository = new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
    sessionRepository: {
      async withSessionReader(_userId, _sessionId, run) {
        const empty = async () => ({ entries: [], sequence: 0, pending: false });
        return run(
          { readTurnMessageDiagnosticPage: empty, readMessageDiagnosticPage: empty },
          { sessionDir },
        );
      },
      async requireSessionScope() {
        return { sessionDir };
      },
      async withSessionMutation(_userId, _sessionId, write) {
        return write({ sessionDir, resolvedParentSessionId: "p1" });
      },
    },
  });
  const repository = new ExecutionLogRepository({ executionRepository });
  const treeFile = path.join(workspaceRoot, "u1", WORKSPACE_LAYOUT.SESSION_TREE_FILE);
  const tree = await readFile(treeFile, "utf8");
  await writeFile(treeFile, JSON.stringify({ nodes: {} }));
  await assert.rejects(
    repository.appendLog("u1", "s1", {
      dialogProcessId: "d1",
      event: "tool_call_start",
      category: "tool",
      type: "tool_call",
      ts: "2026-11-16T00:00:00.000Z",
      data: { tool: "read_file" },
    }),
    (error) => {
      assert.equal(error.code, "EXECUTION_LOG_PROJECTION_FAILED");
      assert.equal(error.commitState, "committed");
      assert.equal(error.cause.code, "RUNTIME_EVENT_SESSION_NOT_REGISTERED");
      return true;
    },
  );
  const cursor = path.join(
    resolveExecutionTurnDir(sessionDir, "d1"),
    EXECUTION_LOG_PROJECTION_CURSOR_FILE,
  );
  await assert.rejects(readFile(cursor), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(eventsDir, "interaction.jsonl")), { code: "ENOENT" });
  assert.equal((await executionRepository.getTurnLogs("u1", "s1", "d1")).length, 1);
  await writeFile(treeFile, tree);
  const restarted = new ExecutionLogRepository({ executionRepository });
  assert.equal((await restarted.recoverSessionLogProjection("u1", "s1")).records, 1);
  const records = (await readFile(path.join(eventsDir, "interaction.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "tool_call_start");
  assert.equal((await restarted.recoverSessionLogProjection("u1", "s1")).records, 0);
  assert.equal((await executionRepository.getTurnLogs("u1", "s1", "d1")).length, 1);
});
