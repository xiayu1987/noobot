/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionLogRepository } from "../../src/observability/execution-log/execution-log-repository.js";
import { withExecutionLogProjection } from "../helpers/execution-log-projection-port.js";
import {
  persistSession,
  persistChildSessionFixture,
  useRuntimeEventsEnv,
  useRuntimeEventsUserWorkspace,
} from "../helpers/runtime-events-env.js";

import { SESSION_CALLER } from "@noobot/shared/session-caller";
const LOG_TS = "2026-05-13T00:00:00.000Z";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-execution-log-repository-"));
}

async function readJsonLines(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createInMemoryExecutionRepository() {
  const turns = new Map();
  const keyOf = (userId = "", sessionId = "", parentSessionId = "") =>
    `${userId}::${parentSessionId}::${sessionId}`;
  return withExecutionLogProjection({
    async appendLogs(userId, sessionId, logs, parentSessionId = "") {
      for (const log of logs) {
        const turnKey = `${keyOf(userId, sessionId, parentSessionId)}::${log.dialogProcessId}`;
        turns.set(turnKey, [...(turns.get(turnKey) || []), log]);
      }
      return logs;
    },
    async getTurnLogs(userId, sessionId, dialogProcessId, parentSessionId = "") {
      return turns.get(`${keyOf(userId, sessionId, parentSessionId)}::${dialogProcessId}`) || [];
    },
  });
}

test("appendLog keeps each dialog's logs in its own turn", async (t) => {
  await persistChildSessionFixture(await useRuntimeEventsUserWorkspace(t, "u1"));
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
  });

  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "start", ts: LOG_TS });
  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "tool_called", ts: LOG_TS });
  await repo.appendLog("u1", "s1", { dialogProcessId: "d2", event: "start", ts: LOG_TS });

  const d1 = await repo.getTurnLogs("u1", "s1", "d1");
  const d2 = await repo.getTurnLogs("u1", "s1", "d2");
  assert.deepEqual(
    d1.map((log) => log.event),
    ["start", "tool_called"],
  );
  assert.deepEqual(
    d2.map((log) => [log.event, log.dialogProcessId]),
    [["start", "d2"]],
  );
});

test("getTurnLogs and appendLog preserve scoped persistence context", async (t) => {
  const workspaceRoot = await useRuntimeEventsUserWorkspace(t, "u1");
  await persistChildSessionFixture(workspaceRoot);
  const sessionDir = await persistSession(workspaceRoot, "u1", {
    sessionId: "child-1",
    parentSessionId: "p1",
    caller: SESSION_CALLER.USER,
  });
  const calls = [];
  const persistenceContext = {
    locationResolver: {
      async locateSessionScope(userId, sessionId) {
        assert.equal(userId, "u1");
        assert.equal(sessionId, "child-1");
        return { sessionDir };
      },
    },
  };
  const executionRepository = {
    async getTurnLogs(...args) {
      calls.push(["getTurnLogs", args]);
      return [];
    },
    async appendLogs(...args) {
      calls.push(["appendLogs", args]);
      return args[2];
    },
  };
  const repo = new ExecutionLogRepository({
    executionRepository: withExecutionLogProjection(executionRepository),
  });

  await repo.getTurnLogs("u1", "child-1", "d1", { persistenceContext });
  await repo.appendLog(
    "u1",
    "child-1",
    { event: "start", dialogProcessId: "d1", ts: LOG_TS },
    { persistenceContext },
  );

  assert.equal(calls[0][0], "getTurnLogs");
  assert.equal(calls[0][1][2], "d1");
  assert.equal(calls[0][1][3].persistenceContext, persistenceContext);
  assert.equal(calls[1][0], "appendLogs");
  assert.equal(calls[1][1][3].persistenceContext, persistenceContext);
});

test("appendLog rejects a missing dialogProcessId without deriving one", async (t) => {
  await persistChildSessionFixture(await useRuntimeEventsUserWorkspace(t, "u1"));
  const appended = [];
  const repo = new ExecutionLogRepository({
    executionRepository: withExecutionLogProjection({
      async getTurnLogs() {
        throw new Error("append path must not load execution history");
      },
      async appendLogs(_userId, _sessionId, logs) {
        appended.push(...logs);
        return logs;
      },
    }),
  });

  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "start", ts: LOG_TS });
  await assert.rejects(repo.appendLog("u1", "s1", { event: "heartbeat", ts: LOG_TS }), {
    code: "DIALOG_PROCESS_ID_INVALID",
  });

  assert.equal(appended[0].dialogProcessId, "d1");
  assert.equal(appended.length, 1);
});

test("appendLog projects the persisted identity rather than caller identity", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const repo = new ExecutionLogRepository({
    executionRepository: withExecutionLogProjection({
      async appendLogs(userId, sessionId, logs) {
        return logs.map((log) => ({ ...log, userId, sessionId, parentSessionId: "p1" }));
      },
    }),
  });

  await repo.appendLog(
    "u1",
    "s1",
    {
      dialogProcessId: "d1",
      event: "tool_call_start",
      category: "tool",
      type: "tool_call",
      parentSessionId: "incorrect-caller-parent",
      data: { tool: "read_file" },
      ts: "2026-05-13T00:00:01.000Z",
    },
    "p1",
  );

  const runtimeEventFile = path.join(eventsDir, "interaction.jsonl");
  const records = await readJsonLines(runtimeEventFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "agent");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "interaction");
  assert.equal(records[0].event, "tool_call_start");
  assert.equal(records[0].sessionId, "s1");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].parentSessionId, "p1");
  assert.equal(records[0].dialogProcessId, "d1");
  assert.equal(records[0].data.executionCategory, "tool");
  assert.equal(records[0].data.type, "tool_call");
  assert.equal(records[0].data.tool, "read_file");
});

test("appendLog mirrors context identity diagnostics to their dedicated runtime-events file", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot, debug: { contextIdentity: true } });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
  });

  await repo.appendLog(
    "u1",
    "s1",
    {
      dialogProcessId: "d1",
      ts: LOG_TS,
      turnScopeId: "t1",
      event: "agent.contextIdentity.modelContextCreated",
      category: "context_identity",
      type: "context_identity_debug",
      data: {
        sourceMessageUid: "sm_1",
        contentProjectionFound: true,
        userMetaProjectionFound: true,
      },
    },
    "p1",
  );

  const runtimeEventFile = path.join(eventsDir, "debug-context-identity.jsonl");
  const records = await readJsonLines(runtimeEventFile);
  assert.equal(records.length, 1);
  assert.equal(records[0].dialogProcessId, "d1");
  assert.equal(records[0].turnScopeId, "t1");
  assert.equal(records[0].data.sourceMessageUid, "sm_1");
  assert.equal(records[0].data.userMetaProjectionFound, true);
});

test("appendLog routes model context traces to the registry-derived debug file, not system", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot, debug: { modelContextTrace: true } });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
  });

  await repo.appendLog(
    "u1",
    "s1",
    {
      dialogProcessId: "d1",
      ts: LOG_TS,
      event: "model_context_trace",
      category: "model_context_trace",
      type: "model_context_trace_debug",
      data: { stage: "resolve_model_messages", turnScopeId: "t1" },
    },
    "p1",
  );

  const records = await readJsonLines(path.join(eventsDir, "debug-model-context-trace.jsonl"));
  assert.equal(records.length, 1);
  assert.equal(records[0].debugType, "model-context-trace");
  assert.equal(Object.hasOwn(records[0].data, "debugType"), false);
  assert.equal(records[0].data.stage, "resolve_model_messages");
  const systemRecords = await readJsonLines(path.join(eventsDir, "system.jsonl")).catch(() => []);
  assert.equal(systemRecords.length, 0);
});

test("appendLog routes durable activity events to the message channel, not system", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
  });

  await repo.appendLog(
    "u1",
    "s1",
    {
      dialogProcessId: "d1",
      ts: LOG_TS,
      event: "thinking",
      category: "activity",
      type: "thinking",
      data: { eventType: "thinking", text: "analysis", turnScopeId: "t1" },
    },
    "p1",
  );

  const records = await readJsonLines(path.join(eventsDir, "message.jsonl"));
  assert.equal(records.length, 1);
  assert.equal(records[0].data.eventType, "thinking");
  const systemRecords = await readJsonLines(path.join(eventsDir, "system.jsonl")).catch(() => []);
  assert.equal(systemRecords.length, 0);
});
