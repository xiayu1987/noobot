/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { ExecutionLogService } from "../../src/observability/execution-log/execution-log-service.js";
import { FileSystemExecutionRepository } from "../../src/session/repositories/file-system-execution-repository.js";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";
import {
  persistChildSessionFixture,
  useRuntimeEventsUserWorkspace,
} from "../helpers/runtime-events-env.js";

function repositoryAt(sessionDir) {
  const executionRepository = new FileSystemExecutionRepository({
    storageService: TEST_STORAGE_SERVICE,
    sessionRepository: {
      async withSessionReader(_userId, _sessionId, run) {
        const empty = async () => ({ entries: [], sequence: 0, pending: false });
        return run({
          reader: { readTurnMessageDiagnosticPage: empty, readMessageDiagnosticPage: empty },
          scope: { sessionDir },
        });
      },
      async requireSessionScope() {
        return { sessionDir };
      },
      async withSessionMutation(_userId, _sessionId, write) {
        return write({ sessionDir, resolvedParentSessionId: "p1" });
      },
    },
  });
  return { executionRepository, repository: new ExecutionLogRepository({ executionRepository }) };
}

test("real runtime output deduplicates source replay after cursor publication fails", async (t) => {
  const workspaceRoot = await useRuntimeEventsUserWorkspace(t, "u1");
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const sessionDir = path.dirname(eventsDir);
  const { executionRepository, repository } = repositoryAt(sessionDir);
  const failure = new Error("projection cursor publication failed");
  setFsAdapter({
    async rename(source, destination) {
      if (destination.endsWith("projection-cursor.json")) throw failure;
      return rename(source, destination);
    },
  });
  t.after(resetFsAdapter);
  await assert.rejects(
    repository.appendLog("u1", "s1", {
      dialogProcessId: "d1",
      event: "tool_call_start",
      category: "tool",
      type: "tool_call",
      ts: "2026-11-15T00:00:00.000Z",
      data: { tool: "read_file" },
    }),
    (error) => error.code === "EXECUTION_LOG_PROJECTION_FAILED" && error.cause === failure,
  );
  const file = path.join(eventsDir, "interaction.jsonl");
  const read = async () => (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  const delivered = await read();
  assert.equal(delivered.length, 1);
  const query = { userId: "u1", sessionId: "s1", dialogProcessId: "d1" };
  const originalLogs = await new ExecutionLogService({ executionRepo: repository }).getTurnLogs(
    query,
  );
  assert.equal(originalLogs.length, 1);
  resetFsAdapter();
  const restarted = repositoryAt(sessionDir);
  assert.equal((await restarted.repository.recoverSessionLogProjection("u1", "s1")).records, 1);
  const replayed = await read();
  assert.deepEqual(replayed, delivered);
  assert.equal((await executionRepository.getTurnLogs("u1", "s1", "d1")).length, 1);
  const service = new ExecutionLogService({ executionRepo: restarted.repository });
  assert.deepEqual(await service.getTurnLogs(query), originalLogs);
  assert.equal((await restarted.repository.recoverSessionLogProjection("u1", "s1")).records, 0);
  assert.deepEqual(await read(), replayed);
});
