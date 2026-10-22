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
import {
  persistChildSessionFixture,
  useRuntimeEventsEnv,
  useRuntimeEventsUserWorkspace,
} from "../helpers/runtime-events-env.js";

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
  return {
    async appendLog(userId, sessionId, log, parentSessionId = "") {
      const turnKey = `${keyOf(userId, sessionId, parentSessionId)}::${log.dialogProcessId}`;
      turns.set(turnKey, [...(turns.get(turnKey) || []), log]);
    },
    async getTurnLogs(userId, sessionId, dialogProcessId, parentSessionId = "") {
      return turns.get(`${keyOf(userId, sessionId, parentSessionId)}::${dialogProcessId}`) || [];
    },
  };
}

test("appendLog keeps each dialog's logs in its own turn", async (t) => {
  await useRuntimeEventsUserWorkspace(t, "u1");
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
    now: () => "2026-05-13T00:00:00.000Z",
  });

  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "start" });
  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "tool_called" });
  await repo.appendLog("u1", "s1", { dialogProcessId: "d2", event: "start" });

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
  await useRuntimeEventsUserWorkspace(t, "u1");
  const calls = [];
  const persistenceContext = { locationResolver: { scopeId: "workflow-node" } };
  const executionRepository = {
    async getTurnLogs(...args) {
      calls.push(["getTurnLogs", args]);
      return [];
    },
    async appendLog(...args) {
      calls.push(["appendLog", args]);
    },
  };
  const repo = new ExecutionLogRepository({ executionRepository });

  await repo.getTurnLogs("u1", "child-1", "d1", { persistenceContext });
  await repo.appendLog(
    "u1",
    "child-1",
    { event: "start", dialogProcessId: "d1" },
    { persistenceContext },
  );

  assert.equal(calls[0][0], "getTurnLogs");
  assert.equal(calls[0][1][2], "d1");
  assert.equal(calls[0][1][3].persistenceContext, persistenceContext);
  assert.equal(calls[1][0], "appendLog");
  assert.equal(calls[1][1][3].persistenceContext, persistenceContext);
});

test("appendLog forwards logs without deriving a dialogProcessId", async (t) => {
  await useRuntimeEventsUserWorkspace(t, "u1");
  const appended = [];
  const repo = new ExecutionLogRepository({
    executionRepository: {
      async getTurnLogs() {
        throw new Error("append path must not load execution history");
      },
      async appendLog(_userId, _sessionId, log) {
        appended.push(log);
      },
    },
    now: () => "2026-05-13T00:00:00.000Z",
  });

  await repo.appendLog("u1", "s1", { dialogProcessId: "d1", event: "start" });
  await repo.appendLog("u1", "s1", { event: "heartbeat" });

  assert.equal(appended[0].dialogProcessId, "d1");
  assert.equal(appended[1].dialogProcessId, "");
});

test("appendLog mirrors session execution logs to runtime-events session events", async (t) => {
  const workspaceRoot = await makeTempDir();
  useRuntimeEventsEnv(t, { workspaceRoot });
  const eventsDir = await persistChildSessionFixture(workspaceRoot);
  const repo = new ExecutionLogRepository({
    executionRepository: createInMemoryExecutionRepository(),
    now: () => "2026-05-13T00:00:00.000Z",
  });

  await repo.appendLog(
    "u1",
    "s1",
    {
      dialogProcessId: "d1",
      event: "tool_call_start",
      category: "tool",
      type: "tool_call",
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
