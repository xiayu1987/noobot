import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SessionExecutionEngine } from "../../../src/system-core/bot-manage/session/session-execution-engine.js";
import { createStateCommitter } from "../../../src/system-core/agent/core/execution/state-committer.js";
import { executeToolCall } from "../../../src/system-core/agent/core/execution/tool-runner.js";
import { createAgentHookManager } from "../../../src/system-core/hook/index.js";

function createWorkspaceService(baseDir) {
  return {
    getWorkspacePath(userId) {
      return path.join(baseDir, userId);
    },
  };
}

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-harness-engine-"));
}

test("_prepareHarnessRunConfig keeps runConfig unchanged when harness is disabled", () => {
  const runConfig = { runtimeModel: "m1" };
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });

  const prepared = engine._prepareHarnessRunConfig({ userId: "u1", runConfig });

  assert.equal(prepared, runConfig);
  assert.equal(prepared.hookManager, undefined);
});

test("_prepareRunConfig attaches independent botHookManager", () => {
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });
  const prepared = engine._prepareRunConfig({
    userId: "u1",
    runConfig: {
      hookManager: createAgentHookManager(),
    },
  });
  assert.ok(prepared.botHookManager);
  assert.notEqual(prepared.botHookManager, prepared.hookManager);
});

test("_prepareHarnessRunConfig registers harness plugin and resolves basePath from user workspace", async () => {
  const tempRoot = await createTempRoot();
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(tempRoot),
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          manifestDebounceMs: 0,
          jsonlFlushStrategy: { maxSize: 1, maxTime: 0, onTerminal: true, onError: true },
        },
      },
    },
  });

  assert.ok(prepared.hookManager);
  assert.equal(prepared.plugins.harness.enabled, true);
  assert.equal(prepared.plugins.harness.basePath, path.join(tempRoot, "u1"));
  assert.equal(prepared.hookManager.list("before_llm_call").length, 1);
  assert.equal(prepared.hookManager.list("after_tool_call").length, 1);

  const messages = [{ role: "user", content: "hello" }];
  await prepared.hookManager.emit("before_llm_call", {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    messages,
  });

  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Noobot Harness/);

  const eventsPath = path.join(tempRoot, "u1", "runtime", "harness", "runs", "d1", "events.jsonl");
  const promptsPath = path.join(tempRoot, "u1", "runtime", "harness", "runs", "d1", "prompts.jsonl");
  assert.match(await fs.readFile(eventsPath, "utf8"), /before_llm_call/);
  assert.match(await fs.readFile(promptsPath, "utf8"), /noobot-harness-policy/);
});

test("_prepareHarnessRunConfig reuses existing hookManager instead of replacing it", () => {
  const hookManager = createAgentHookManager();
  hookManager.on("before_llm_call", () => {}, { id: "existing.before_llm_call" });
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      hookManager,
      plugins: { harness: { enabled: true, mode: "on", basePath: "/tmp/noobot-test/u1" } },
    },
  });

  assert.equal(prepared.hookManager, hookManager);
  assert.equal(hookManager.list("before_llm_call").length, 2);

  const preparedAgain = engine._prepareHarnessRunConfig({ userId: "u1", runConfig: prepared });
  assert.equal(preparedAgain.hookManager, hookManager);
  assert.equal(hookManager.list("before_llm_call").length, 2);
});

test("globalConfig.plugins.harness.mode=on enables harness by default", () => {
  const tempRoot = "/tmp/noobot-global-harness-test";
  const engine = new SessionExecutionEngine({
    globalConfig: { plugins: { harness: { enabled: true, mode: "on", trace: false } } },
    workspaceService: createWorkspaceService(tempRoot),
  });

  const prepared = engine._prepareHarnessRunConfig({ userId: "u2", runConfig: {} });

  assert.ok(prepared.hookManager);
  assert.equal(prepared.plugins.harness.enabled, true);
  assert.equal(prepared.plugins.harness.trace, false);
  assert.equal(prepared.plugins.harness.basePath, path.join(tempRoot, "u2"));
});

test("runSession smoke writes harness artifacts through full execution pipeline", async () => {
  const tempRoot = await createTempRoot();
  const persistedTurns = [];
  const executionLogs = [];
  let savedCurrentTurnTasksPayload = null;
  let capturedRuntime = null;
  let capturedAgentUserMessage = "";

  const sessionId = randomUUID();

  const session = {
    async upsertSessionTree() {},
    async getSessionBundle() {
      return { exists: false, session: {} };
    },
    async createSession() {},
    async getExecutionBundle() {
      return { logs: executionLogs };
    },
    async appendExecutionLog(payload = {}) {
      executionLogs.push(payload);
    },
    async appendTurn(payload = {}) {
      persistedTurns.push(payload);
    },
    async saveCurrentTurnTasks(payload = {}) {
      savedCurrentTurnTasksPayload = payload;
    },
  };

  const engine = new SessionExecutionEngine({
    globalConfig: {},
    session,
    memory: {
      async captureSessionToShortMemory() {},
      async maybeSummarize() {},
    },
    attach: {},
    skill: {},
    configService: {
      async loadUserConfig() {
        return { memory: { postprocess_async: false, summarize_async: false } };
      },
    },
    workspaceService: {
      async ensureUserWorkspace(userId) {
        return path.join(tempRoot, userId);
      },
      getWorkspacePath(userId) {
        return path.join(tempRoot, userId);
      },
    },
    errorLogger: { async log() {} },
    botManager: {},
    agentRunner: async ({ agentContext, userMessage }) => {
      capturedRuntime = agentContext?.execution?.controllers?.runtime || null;
      capturedAgentUserMessage = userMessage;
      const messages = [{ role: "user", content: userMessage }];
      await capturedRuntime.hookManager.emit("before_llm_call", {
        userId: "u1",
        sessionId,
        dialogProcessId: capturedRuntime.systemRuntime.dialogProcessId,
        agentContext,
        messages,
      });
      return {
        output: "ok from fake agent",
        traces: [{ type: "fake" }],
        turnMessages: [{ role: "assistant", type: "message", content: "ok from fake agent" }],
        turnTasks: [{ taskId: "t1", status: "done" }],
      };
    },
  });

  const result = await engine.runSession({
    userId: "u1",
    sessionId,
    message: "hello harness",
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: {
          manifestDebounceMs: 0,
          jsonlFlushStrategy: { maxSize: 1, maxTime: 0, onTerminal: true, onError: true },
        },
      },
    },
  });

  assert.equal(result.answer, "ok from fake agent");
  assert.equal(capturedAgentUserMessage, "hello harness");
  assert.ok(capturedRuntime?.hookManager);
  assert.equal(savedCurrentTurnTasksPayload?.currentTurnTasks?.[0]?.taskId, "t1");
  assert.ok(persistedTurns.some((turn) => turn.role === "user" && turn.content === "hello harness"));
  assert.ok(persistedTurns.some((turn) => turn.role === "assistant" && turn.content === "ok from fake agent"));

  const runDir = path.join(
    tempRoot,
    "u1",
    "runtime",
    "harness",
    "runs",
    result.dialogProcessId,
  );
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  const events = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const snapshot = JSON.parse(await fs.readFile(path.join(runDir, "context-snapshot.json"), "utf8"));
  const prompts = await fs.readFile(path.join(runDir, "prompts.jsonl"), "utf8");

  assert.equal(manifest.dialogProcessId, result.dialogProcessId);
  assert.equal(manifest.userId, "u1");
  assert.match(events, /after_context_build/);
  assert.match(events, /before_llm_call/);
  assert.equal(snapshot.dialogProcessId, result.dialogProcessId);
  assert.equal(snapshot.userId, "u1");
  assert.match(prompts, /noobot-harness-policy/);
});


test("harness records tool call and state commit hook artifacts", async () => {
  const tempRoot = await createTempRoot();
  const hookManager = createAgentHookManager();
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(tempRoot),
  });
  const dialogProcessId = "dp-tool-state-smoke";
  const sessionId = randomUUID();
  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      hookManager,
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          manifestDebounceMs: 0,
          jsonlFlushStrategy: { maxSize: 1, maxTime: 0, onTerminal: true, onError: true },
        },
      },
    },
  });
  const runtime = {
    ...prepared,
    userId: "u1",
    basePath: path.join(tempRoot, "u1"),
    systemRuntime: { userId: "u1", sessionId, dialogProcessId },
  };
  const agentContext = {
    execution: {
      dialogProcessId,
      controllers: { runtime },
    },
    environment: { identity: { userId: "u1" }, workspace: { basePath: runtime.basePath } },
  };

  const successCall = { id: "call_ok", name: "demo_tool", args: { x: 1 } };
  const successResult = await executeToolCall({
    call: successCall,
    tool: { async invoke(args) { return { ok: true, echoed: args.x }; } },
    runtime,
    agentContext,
    userId: "u1",
    sessionId,
    turn: 1,
  });
  assert.equal(successResult.success, true);

  const errorCall = { id: "call_fail", name: "failing_tool", args: { y: 2 } };
  const errorResult = await executeToolCall({
    call: errorCall,
    tool: { async invoke() { throw new Error("boom from test tool"); } },
    runtime,
    agentContext,
    userId: "u1",
    sessionId,
    turn: 1,
  });
  assert.equal(errorResult.success, false);
  assert.equal(errorResult.failureReason, "invoke_error");

  const turnMessageStore = { items: [], push(item = {}) { this.items.push(item); } };
  const committer = createStateCommitter({
    messages: [],
    traces: [],
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext,
  });
  await committer.pushAssistantMessage({ content: "assistant committed" });
  await committer.pushToolResult({ call: successCall, toolResultText: successResult.toolResultText });

  const runDir = path.join(tempRoot, "u1", "runtime", "harness", "runs", dialogProcessId);
  const events = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const toolCalls = await fs.readFile(path.join(runDir, "tool-calls.jsonl"), "utf8");
  const stateCommits = await fs.readFile(path.join(runDir, "state-commits.jsonl"), "utf8");

  assert.match(events, /before_tool_call/);
  assert.match(events, /after_tool_call/);
  assert.match(events, /tool_call_error/);
  assert.match(events, /before_state_commit/);
  assert.match(events, /after_state_commit/);
  assert.match(toolCalls, /demo_tool/);
  assert.match(toolCalls, /failing_tool/);
  assert.match(toolCalls, /tool_call_error/);
  assert.match(stateCommits, /assistant_message/);
  assert.match(stateCommits, /tool_result/);
  assert.equal(turnMessageStore.items.length, 2);
});
