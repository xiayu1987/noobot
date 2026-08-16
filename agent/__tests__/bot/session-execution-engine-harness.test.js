/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SessionExecutionEngine } from "../../src/bot/session/session-execution-engine.js";
import { createStateCommitter } from "../../src/runtime/tool-execution/state-committer.js";
import { executeToolCall } from "../../src/runtime/tool-execution/tool-runner.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createModelContext, getMessageId } from "@noobot/context-protocol";

function createWorkspaceService(baseDir) {
  return {
    getWorkspacePath(userId) {
      return path.join(baseDir, userId);
    },
  };
}

async function createTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-plugin-engine-"));
}

test("_prepareRunConfig attaches independent botHookManager", () => {
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });
  const prepared = engine._prepareRunConfig({
    userId: "u1",
    runConfig: {
      hookManager: createHookManager(),
    },
  });
  assert.ok(prepared.botHookManager);
  assert.notEqual(prepared.botHookManager, prepared.hookManager);
});

test("_finalizeRunSession preserves the child lifecycle terminal receipt", async () => {
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });
  const lifecycle = {
    executionId: "agent:workflow-node:t1",
    executionKind: "agent",
    state: "completed",
    revision: 4,
    sequence: 4,
  };
  let forwardedLifecycle = null;
  engine.finalizer.finalizeRunSession = async (payload = {}) => {
    forwardedLifecycle = payload.lifecycle;
    return { lifecycle: payload.lifecycle };
  };

  const result = await engine._finalizeRunSession({
    userId: "u1",
    sessionId: "child-s1",
    lifecycle,
  });

  assert.equal(forwardedLifecycle, lifecycle);
  assert.equal(result.lifecycle, lifecycle);
});

test("_finalizeRunSession forwards staged persistence state unchanged", async () => {
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });
  let forwarded = null;
  engine.finalizer.finalizeRunSession = async (payload = {}) => {
    forwarded = payload;
    return {};
  };
  const persistedTurnMessages = [{ role: "assistant", content: "persisted" }];
  const summaryCheckpointPromotionSources = [{ role: "tool", attachments: [{ id: "a1" }] }];

  await engine._finalizeRunSession({
    userId: "u1",
    sessionId: "s1",
    alreadyPersistedTurnMessageCount: 1,
    persistedTurnMessages,
    summaryCheckpointPromotionSources,
  });

  assert.equal(forwarded.alreadyPersistedTurnMessageCount, 1);
  assert.equal(forwarded.persistedTurnMessages, persistedTurnMessages);
  assert.equal(forwarded.summaryCheckpointPromotionSources, summaryCheckpointPromotionSources);
});

test("RunConfigPluginPreparer.prepareRunConfig activates harness by Manifest id and resolves basePath", async () => {
  const tempRoot = await createTempRoot();
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(tempRoot),
  });

  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["harness"],
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
  assert.equal(prepared.hookManager.list(HOOK_POINT.AGENT.BEFORE_LLM_CALL).length, 1);
  assert.equal(prepared.hookManager.list(HOOK_POINT.AGENT.AFTER_TOOL_CALL).length, 1);

  const messages = [{ role: "user", content: "hello" }];
  const hookCtx = {
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    contextProtocolVersion: 2,
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: messages },
    }),
  };
  await prepared.hookManager.emit(HOOK_POINT.AGENT.BEFORE_LLM_CALL, hookCtx);

  const resolvedMessages = hookCtx.modelContext.messages;
  const resolvedBlocks = hookCtx.modelContext.messageBlocks;
  assert.equal(resolvedMessages[0].role, "system");
  assert.match(resolvedMessages[0].content, /\[HARNESS_POLICY_SELECTION\]/);
  assert.match(resolvedMessages[0].content, /policy_prompt = harness_policy\/general/);
  assert.doesNotMatch(resolvedMessages[0].content, /execution_first|risk_first/);
  assert.equal(resolvedMessages[1].role, "user");
  assert.equal(resolvedMessages[1].content, "hello");
  assert.equal(resolvedBlocks.system[0], resolvedMessages[0]);
  assert.equal(resolvedBlocks.incremental[0], resolvedMessages[1]);

  const eventsPath = path.join(tempRoot, "u1", "runtime", "harness", "runs", "d1", "events.jsonl");
  const promptsPath = path.join(
    tempRoot,
    "u1",
    "runtime",
    "harness",
    "runs",
    "d1",
    "prompts.jsonl",
  );
  assert.match(await fs.readFile(eventsPath, "utf8"), /before_llm_call/);
  assert.match(await fs.readFile(promptsPath, "utf8"), /noobot-harness-policy/);
});

test("Harness before_llm_call preserves canonical ids and block ownership across agent normalization", async () => {
  const tempRoot = await createTempRoot();
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(tempRoot),
  });
  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u-identity",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          trace: false,
          planning: { enabled: false },
          guidance: { enabled: false },
          acceptance: { enabled: false },
          review: { enabled: false },
        },
      },
    },
  });
  const modelContext = createModelContext({
    messageBlocks: {
      system: [{ role: "system", content: "system" }],
      history: [
        {
          role: "user",
          content: "history-user",
          dialogProcessId: "d-history",
          turnScopeId: "t-history",
        },
        {
          role: "assistant",
          content: "history-assistant",
          dialogProcessId: "d-history",
          turnScopeId: "t-history",
        },
      ],
      incremental: [
        {
          role: "user",
          content: "current-user",
          dialogProcessId: "d-current",
          turnScopeId: "t-current",
        },
        {
          role: "assistant",
          content: "current-assistant",
          dialogProcessId: "d-current",
          turnScopeId: "t-current",
        },
      ],
    },
  });
  const historyIds = modelContext.messageBlocks.history.map(getMessageId);
  const incrementalIds = modelContext.messageBlocks.incremental.map(getMessageId);
  const hookCtx = {
    userId: "u-identity",
    sessionId: "s-identity",
    dialogProcessId: "d-current",
    turnScopeId: "t-current",
    contextProtocolVersion: 2,
    modelContext,
  };

  await prepared.hookManager.emit(HOOK_POINT.AGENT.BEFORE_LLM_CALL, hookCtx);

  assert.deepEqual(modelContext.messageBlocks.history.map(getMessageId), historyIds);
  assert.deepEqual(modelContext.messageBlocks.incremental.map(getMessageId), incrementalIds);
  assert.deepEqual(
    modelContext.messageBlocks.incremental.map((message) => message.content),
    ["current-user", "current-assistant"],
  );
  assert.equal(new Set(modelContext.messages.map(getMessageId)).size, modelContext.messages.length);
  assert.equal(
    historyIds.some((id) => incrementalIds.includes(id)),
    false,
  );
});

test("RunConfigPluginPreparer.prepareRunConfig reuses existing hookManager instead of replacing it", () => {
  const hookManager = createHookManager();
  hookManager.on(HOOK_POINT.AGENT.BEFORE_LLM_CALL, () => {}, { id: "existing.before_llm_call" });
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService("/tmp/noobot-test"),
  });

  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u1",
    runConfig: {
      hookManager,
      selectedPlugins: ["harness"],
      plugins: { harness: { enabled: true, mode: "on", basePath: "/tmp/noobot-test/u1" } },
    },
  });

  assert.equal(prepared.hookManager, hookManager);
  assert.equal(hookManager.list(HOOK_POINT.AGENT.BEFORE_LLM_CALL).length, 2);

  const preparedAgain = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u1",
    runConfig: prepared,
  });
  assert.equal(preparedAgain.hookManager, hookManager);
  assert.equal(hookManager.list(HOOK_POINT.AGENT.BEFORE_LLM_CALL).length, 2);
});

test("global plugin defaults do not activate a plugin absent from selectedPlugins", () => {
  const tempRoot = "/tmp/noobot-global-plugin-test";
  const engine = new SessionExecutionEngine({
    globalConfig: { plugins: { harness: { enabled: true, mode: "on", trace: false } } },
    workspaceService: createWorkspaceService(tempRoot),
  });

  const unselected = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u2",
    runConfig: {},
  });
  assert.equal(unselected.plugins.harness, undefined);
  assert.equal(unselected.hookManager.list(HOOK_POINT.AGENT.BEFORE_LLM_CALL).length, 0);

  const selected = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u2",
    runConfig: { selectedPlugins: ["harness"] },
  });
  assert.equal(selected.plugins.harness.enabled, true);
  assert.equal(selected.plugins.harness.trace, false);
  assert.equal(selected.plugins.harness.basePath, path.join(tempRoot, "u2"));
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
    async commitTurn(payload = {}) {
      const messageUid = `sm_${payload.turnScopeId}`;
      const userMessage = {
        messageUid,
        id: payload.messageId || messageUid,
        messageId: payload.messageId || messageUid,
        role: "user",
        type: "message",
        content: payload.content,
        userName: payload.userId,
        sessionId: payload.sessionId,
        parentSessionId: payload.parentSessionId,
        dialogProcessId: payload.dialogProcessId,
        parentDialogProcessId: payload.parentDialogProcessId,
        turnScopeId: payload.turnScopeId,
        frontendUserMessage: payload.frontendUserMessage === true,
        messageOrigin: payload.frontendUserMessage === true ? "user" : "internal",
        attachments: payload.attachments || [],
      };
      persistedTurns.push(userMessage);
      return { userMessage, attachments: userMessage.attachments, aggregateVersion: 1 };
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
        return { memory: { postprocess_async: false } };
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
    agentRunner: async ({ agentContext, currentUserMessage }) => {
      capturedRuntime = agentContext?.bindings?.runtime || null;
      capturedAgentUserMessage = currentUserMessage.content;
      assert.equal(currentUserMessage.messageUid, "sm_turn-scope-smoke");
      const messages = [currentUserMessage];
      await capturedRuntime.hookManager.emit(HOOK_POINT.AGENT.BEFORE_LLM_CALL, {
        userId: "u1",
        sessionId,
        dialogProcessId: capturedRuntime.systemRuntime.dialogProcessId,
        agentContext,
        contextProtocolVersion: 2,
        modelContext: createModelContext({
          messageBlocks: { system: [], history: [], incremental: messages },
        }),
      });
      return {
        output: "ok from fake agent",
        assistantMessageId: "harness-assistant-message",
        traces: [{ type: "fake" }],
        turnMessages: [
          {
            messageId: "harness-assistant-message",
            role: "assistant",
            type: "message",
            content: "ok from fake agent",
          },
        ],
        turnTasks: [{ taskId: "t1", status: "done" }],
      };
    },
  });

  const result = await engine.runSession({
    userId: "u1",
    sessionId,
    message: "hello plugin",
    runConfig: {
      turnScopeId: "turn-scope-smoke",
      executionId: "agent:turn-scope-smoke",
      executionKind: "agent",
      rootExecutionId: "agent:turn-scope-smoke",
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
  assert.equal(capturedAgentUserMessage, "hello plugin");
  assert.ok(capturedRuntime?.hookManager);
  assert.equal(savedCurrentTurnTasksPayload?.currentTurnTasks?.[0]?.taskId, "t1");
  assert.ok(
    persistedTurns.some(
      (turn) =>
        turn.role === "user" &&
        turn.content === "hello plugin" &&
        turn.turnScopeId === "turn-scope-smoke",
    ),
  );
  assert.ok(
    persistedTurns.some(
      (turn) =>
        turn.role === "assistant" &&
        turn.content === "ok from fake agent" &&
        turn.turnScopeId === "turn-scope-smoke",
    ),
  );

  const runDir = path.join(tempRoot, "u1", "runtime", "harness", "runs", result.dialogProcessId);
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "harness-run.json"), "utf8"));
  const events = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const snapshot = JSON.parse(
    await fs.readFile(path.join(runDir, "context-snapshot.json"), "utf8"),
  );
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
  const hookManager = createHookManager();
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(tempRoot),
  });
  const dialogProcessId = "dp-tool-state-smoke";
  const sessionId = randomUUID();
  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u1",
    runConfig: {
      hookManager,
      selectedPlugins: ["harness"],
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
  const agentContext = createTestAgentExecutionScope(runtime);

  const successCall = { id: "call_ok", name: "demo_tool", args: { x: 1 } };
  const successResult = await executeToolCall({
    call: successCall,
    tool: {
      async invoke(args) {
        return { ok: true, echoed: args.x };
      },
    },
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
    tool: {
      async invoke() {
        throw new Error("boom from test tool");
      },
    },
    runtime,
    agentContext,
    userId: "u1",
    sessionId,
    turn: 1,
  });
  assert.equal(errorResult.success, false);
  assert.equal(errorResult.failureReason, "invoke_error");

  const turnMessageStore = {
    items: [],
    push(item = {}) {
      this.items.push(item);
    },
  };
  runtime.materializePendingCurrentTurnMessageEvents = () => ({
    activityTimeline: [],
    toolTimeline: [],
  });
  const committer = createStateCommitter({
    modelContext: createModelContext({
      activeTurnIdentity: { dialogProcessId, turnScopeId: "turn-tool-hook" },
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
    traces: [],
    turnMessageStore,
    dialogProcessId,
    runtime,
    agentContext,
  });
  await committer.pushAssistantMessage({ content: "assistant committed" });
  await committer.pushToolResult({
    call: successCall,
    toolResultText: successResult.toolResultText,
  });

  const runDir = path.join(tempRoot, "u1", "runtime", "harness", "runs", dialogProcessId);
  const events = await fs.readFile(path.join(runDir, "events.jsonl"), "utf8");
  const eventRecords = events
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.match(events, /before_tool_call/);
  assert.match(events, /after_tool_call/);
  assert.match(events, /tool_call_error/);
  assert.match(events, /before_state_commit/);
  assert.match(events, /after_state_commit/);
  const hookPayloadOf = (event) => event.payload || event.data || event;
  const hookToolOf = (event) => hookPayloadOf(event).tool || hookPayloadOf(event).toolName;
  assert.ok(
    eventRecords.some((event) => event.kind === "hook" && hookToolOf(event) === "demo_tool"),
  );
  assert.ok(
    eventRecords.some((event) => event.kind === "hook" && hookToolOf(event) === "failing_tool"),
  );
  assert.ok(
    eventRecords.some(
      (event) => event.kind === "hook" && event.point === HOOK_POINT.AGENT.TOOL_CALL_ERROR,
    ),
  );
  assert.ok(
    eventRecords.some(
      (event) => event.kind === "hook" && hookPayloadOf(event).commitType === "assistant_message",
    ),
  );
  assert.ok(
    eventRecords.some(
      (event) => event.kind === "hook" && hookPayloadOf(event).commitType === "tool_result",
    ),
  );
  assert.equal(turnMessageStore.items.length, 2);
});
