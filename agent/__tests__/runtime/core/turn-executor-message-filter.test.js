/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext, writeMessageBlocks } from "@noobot/context-protocol";

import {
  invokeNoToolsTurn as invokeNoToolsTurnProduction,
  invokeWithToolsTurn as invokeWithToolsTurnProduction,
} from "../../../src/runtime/turn/turn-executor.js";
import { requestMainFlowSummaryCheckpoint } from "../../../src/runtime/main-flow-control.js";
import { prepareTestTurnExecution } from "./turn-runtime-test-helper.js";

function invokeNoToolsTurn(args = {}) {
  prepareTestTurnExecution(args.modelState, args.loopState, `no-tools-${args.loopState?.dialogProcessId || "turn"}`);
  return invokeNoToolsTurnProduction(args);
}

function invokeWithToolsTurn(args = {}) {
  prepareTestTurnExecution(args.modelState, args.loopState, `with-tools-${args.loopState?.dialogProcessId || "turn"}`);
  return invokeWithToolsTurnProduction(args);
}

test("invokeNoToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    async invoke(messages) {
      capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
      return { content: "ok" };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
      { role: "assistant", content: "summarized", summarized: true },
      { role: "user", content: "keep-user" },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
        { role: "assistant", content: "summarized", summarized: true },
        { role: "user", content: "keep-user" },
      ],
    },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d1",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "user", content: "keep-user" },
    ],
  );
  assert.equal(result.output, "ok");
  const finalResponse = loopState.modelContext.messages.at(-1);
  assert.equal(finalResponse.content, "ok");
  assert.equal(loopState.modelContext.messageBlocks.incremental.at(-1), finalResponse);
});

test("invokeWithToolsTurn filters only summarized messages before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return { content: "ok-with-tools", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
      { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
      { role: "assistant", content: "drop-summarized", summarized: true },
    ],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [
        { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "execute_script" } }] },
        { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
        { role: "assistant", content: "keep-assistant" },
        { role: "user", content: "keep-user" },
        { role: "assistant", content: "drop-summarized", summarized: true },
      ],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d2",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  assert.equal(result.aiContentText, "ok-with-tools");
  assert.deepEqual(
    capturedMessages.map((item) => ({ role: item.role, content: item.content })),
    [
      { role: "assistant", content: "" },
      { role: "tool", content: "{\"ok\":true}" },
      { role: "assistant", content: "keep-assistant" },
      { role: "user", content: "keep-user" },
    ],
  );
  const finalAssistant = loopState.modelContext.messages.at(-1);
  assert.equal(finalAssistant.content, "ok-with-tools");
  assert.equal(loopState.modelContext.messageBlocks.incremental.at(-1), finalAssistant);
});

test("invokeWithToolsTurn sends system history incremental order after before_llm_call hooks", async () => {
  let capturedMessages = [];
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "before_llm_call") return [];
        // A detached flat projection is not a writable context source. The
        // authoritative blocks remain unchanged.
        return [];
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const system = { role: "system", content: "sys" };
  const history = { role: "assistant", content: "hist", dialogProcessId: "d-old" };
  const incremental = { role: "user", content: "current", dialogProcessId: "d-current" };
  const modelState = {
    llm,
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [system, history, incremental],
    messageBlocks: {
      system: [system],
      history: [history],
      incremental: [incremental],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-current",
    maxTurns: 1,
  };
  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => `${item.role}:${item.content}`),
    ["system:sys", "assistant:hist", "user:current"],
  );
});

test("invokeWithToolsTurn commits a separate-model summary checkpoint before model projection", async () => {
  let capturedMessages = [];
  const current = { role: "user", content: "current-user" };
  const toolCall = {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call-covered", function: { name: "execute_script" } }],
  };
  const toolResult = {
    role: "tool",
    content: "covered-result",
    tool_call_id: "call-covered",
  };
  const summary = { role: "user", content: "summary-relay" };
  let loopState = null;
  let checkpointCount = 0;
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "before_llm_call") return [];
        writeMessageBlocks(ctx.modelContext, {
          incremental: [...ctx.modelContext.messageBlocks.incremental, summary],
        });
        requestMainFlowSummaryCheckpoint(runtime, {
          source: "plugin.summary",
          summarizedMessageIds: ["tool-call", "tool-result"],
        });
        return [];
      },
    },
    async commitSummaryCheckpoint() {
      checkpointCount += 1;
      writeMessageBlocks(loopState.modelContext, {
        incremental: loopState.modelContext.messageBlocks.incremental.filter(
          (message) => message !== toolCall && message !== toolResult,
        ),
      });
      return { committed: true };
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = [...messages];
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const modelState = {
    llm,
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  loopState = {
    messages: [current, toolCall, toolResult],
    messageBlocks: { system: [], history: [], incremental: [current, toolCall, toolResult] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-summary",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(checkpointCount, 1);
  assert.deepEqual(
    capturedMessages.map((message) => `${message.role}:${message.content}`),
    ["user:current-user", "user:summary-relay"],
  );
});


test("invokeWithToolsTurn reconciles replaced hook messageBlocks before llm invoke", async () => {
  let capturedMessages = [];
  const harnessSystem = { role: "developer", content: "harness-policy" };
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "before_llm_call") return [];
        writeMessageBlocks(ctx.modelContext, {
          system: [...ctx.modelContext.messageBlocks.system, harnessSystem],
          history: [...ctx.modelContext.messageBlocks.history],
          incremental: [...ctx.modelContext.messageBlocks.incremental],
        });
        return [];
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || (typeof item._getType === "function" ? item._getType() : ""),
            content: item.content,
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const system = { role: "system", content: "constructed-system" };
  const history = { role: "assistant", content: "recent-history", dialogProcessId: "d-old" };
  const current = { role: "user", content: "current-user", dialogProcessId: "d-current" };
  const modelState = {
    llm,
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [system, history, current],
    messageBlocks: {
      system: [system],
      history: [history],
      incremental: [current],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-current",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(capturedMessages, [
    { role: "system", content: "constructed-system" },
    { role: "developer", content: "harness-policy" },
    { role: "assistant", content: "recent-history" },
    { role: "user", content: "current-user" },
  ]);
  assert.equal(loopState.modelContext.messageBlocks.system.at(-1), harnessSystem);
});

test("invokeWithToolsTurn adopts canonical hook messages on first stopped-snapshot resume turn", async () => {
  let capturedMessages = [];
  const harnessSystem = { role: "developer", content: "harness-policy", messageUid: "hook-system" };
  const latestGuidance = {
    role: "user",
    content: "latest-guidance",
    messageUid: "latest-guidance",
    injectedMessage: true,
    injectedBy: "noobot-plugin-harness",
    injectedMessageType: "separate_model_relay:guidance",
  };
  const runtime = {
    resumeFromStoppedSnapshot: true,
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "before_llm_call") return [];
        writeMessageBlocks(ctx.modelContext, {
          system: [...ctx.modelContext.messageBlocks.system, harnessSystem],
          history: [...ctx.modelContext.messageBlocks.history],
          incremental: [
            ...ctx.modelContext.messageBlocks.incremental,
            latestGuidance,
          ],
        });
        return [];
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || (typeof item._getType === "function" ? item._getType() : ""),
            content: item.content,
            dialogProcessId: item.dialogProcessId || item.additional_kwargs?.dialogProcessId || "",
            turnScopeId: item.turnScopeId || item.additional_kwargs?.turnScopeId || "",
            internalType: item.additional_kwargs?.noobotInternalMessageType || "",
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const snapshotSystem = { role: "system", content: "snapshot-system" };
  const snapshotHistory = { role: "assistant", content: "snapshot-history", dialogProcessId: "d-stopped" };
  const resumedUser = {
    role: "user",
    content: "resume-user",
    additional_kwargs: { dialogProcessId: "d-resume", turnScopeId: "turn-current" },
  };
  const staleGuidance = {
    role: "user",
    content: "stale-guidance",
    messageUid: "stale-guidance",
    dialogProcessId: "d-resume",
    turnScopeId: "turn-current",
    injectedMessage: true,
    injectedBy: "noobot-plugin-harness",
    injectedMessageType: "separate_model_relay:guidance",
  };
  const userMeta = {
    role: "user",
    content: '[用户元信息]\n{"dialogProcessId":"d-resume","turnScopeId":"turn-current"}\n[/用户元信息]',
    additional_kwargs: {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      noobotInternalMessageType: "user_meta",
    },
  };
  const modelState = {
    llm,
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [snapshotSystem, snapshotHistory, staleGuidance, resumedUser, userMeta],
    messageBlocks: {
      system: [snapshotSystem],
      history: [snapshotHistory],
      incremental: [staleGuidance, resumedUser, userMeta],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-resume",
    maxTurns: 1,
  };
  loopState.modelContext = createModelContext({
    messages: loopState.messages,
    messageBlocks: loopState.messageBlocks,
    activeTurnIdentity: {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
    },
  });

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(capturedMessages, [
    { role: "system", content: "snapshot-system", dialogProcessId: "", turnScopeId: "", internalType: "" },
    { role: "developer", content: "harness-policy", dialogProcessId: "d-resume", turnScopeId: "turn-current", internalType: "" },
    { role: "assistant", content: "snapshot-history", dialogProcessId: "d-stopped", turnScopeId: "", internalType: "" },
    { role: "user", content: "stale-guidance", dialogProcessId: "d-resume", turnScopeId: "turn-current", internalType: "" },
    { role: "user", content: "resume-user", dialogProcessId: "d-resume", turnScopeId: "turn-current", internalType: "" },
    {
      role: "user",
      content: '[用户元信息]\n{"dialogProcessId":"d-resume","turnScopeId":"turn-current"}\n[/用户元信息]',
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "user_meta",
    },
    { role: "user", content: "latest-guidance", dialogProcessId: "d-resume", turnScopeId: "turn-current", internalType: "" },
  ]);
  assert.equal(loopState.modelContext.messageBlocks.system.includes(harnessSystem), true);
  assert.equal(loopState.modelContext.messageBlocks.incremental.includes(latestGuidance), true);
  assert.equal(loopState.modelContext.messageBlocks.incremental.includes(staleGuidance), true);
  assert.equal(capturedMessages.some((message) => message?.content === "stale-guidance"), true);
});

test("invokeWithToolsTurn does not rehydrate missing blocks from legacy agentContext payload", async () => {
  let capturedMessages = [];
  const runtime = {
    systemRuntime: { sessionId: "s1", dialogProcessId: "d-current" },
    hookManager: {
      async emit() {
        return [];
      },
    },
  };
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || (typeof item._getType === "function" ? item._getType() : ""),
            content: item.content,
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const current = { role: "user", content: "current-user", dialogProcessId: "d-current" };
  const modelState = {
    llm,
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
    agentContext: {
      execution: {
        dialogProcessId: "d-current",
        controllers: { runtime },
      },
      payload: {
        messages: {
          system: ["constructed-system"],
          history: [
            { role: "user", content: "history-user", dialogProcessId: "d-old" },
            { role: "assistant", content: "history-assistant", dialogProcessId: "d-old" },
          ],
        },
      },
    },
  };
  const loopState = {
    messages: [current],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [current],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-current",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(capturedMessages, [{ role: "user", content: "current-user" }]);
});

test("invokeWithToolsTurn stores assistant tool-call message in incremental block", async () => {
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "",
            tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "run tool" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "run tool" }] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-tool-call",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.calls.length, 1);
  const assistantToolCall = loopState.modelContext.messages.at(-1);
  assert.equal(Array.isArray(assistantToolCall.tool_calls), true);
  assert.equal(loopState.modelContext.messageBlocks.incremental.at(-1), assistantToolCall);
  assert.equal(
    assistantToolCall.additional_kwargs.noobotMessageId,
    result.turnMessageStore.toArray().at(-1).messageUid,
  );
});

test("invokeWithToolsTurn does not final-stream when runConfig disables streaming", async () => {
  const events = [];
  const llm = {
    bindTools() {
      return {
        async invoke() {
          return {
            content: "ok-without-final-stream",
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {
        sessionId: "child-session",
        dialogProcessId: "d-stream-disabled",
        turnScopeId: "workflow-node:stream-disabled",
      },
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: {
      onEvent(payload = {}) {
        events.push(payload);
      },
    },
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "keep-user" }],
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-stream-disabled",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok-without-final-stream");
  assert.equal(result.finalStreaming, null);
  assert.equal(
    events.some((item) => String(item?.event || "") === "llm_final_stream_start"),
    false,
  );
  assert.equal(events.some((item) => item?.event === "main_model_content"), false);
});

test("invokeNoToolsTurn stores reasoning-only retry prompt in incremental block", async () => {
  let callCount = 0;
  const llm = {
    async invoke() {
      callCount += 1;
      if (callCount === 1) {
        return { content: "", additional_kwargs: { reasoning_content: "thinking only" } };
      }
      return { content: "ok after retry" };
    },
  };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-no-tools",
    maxTurns: 1,
  };

  const result = await invokeNoToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.output, "ok after retry");
  const retryPrompt = loopState.modelContext.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking only"),
  );
  assert.ok(retryPrompt);
});

test("invokeWithToolsTurn stores reasoning-only retry prompt in incremental block", async () => {
  let callCount = 0;
  const llm = {
    bindTools() {
      return {
        async invoke() {
          callCount += 1;
          if (callCount === 1) {
            return { content: "", additional_kwargs: { reasoning_content: "thinking with tools" } };
          }
          return {
            content: "ok with tools after retry",
            tool_calls: [],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    llm,
    runtime: {
      runConfig: { streaming: false },
      systemRuntime: {},
    },
    globalConfig: { streaming: true },
    userConfig: {},
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [{ role: "user", content: "go" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "go" }] },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d-reasoning-tools",
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.equal(result.aiContentText, "ok with tools after retry");
  const retryPrompt = loopState.modelContext.messageBlocks.incremental.find((message) =>
    String(message?.content || "").includes("thinking with tools"),
  );
  assert.ok(retryPrompt);
});

test("invokeWithToolsTurn normalizes dirty blocks to system history incremental before llm invoke", async () => {
  let capturedMessages = [];
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({ ...item }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const system = { role: "system", content: "sys" };
  const misplacedSystem = { role: "system", content: "misplaced-system", dialogProcessId: "d1" };
  const duplicateHistoryUser = { role: "user", content: "current", dialogProcessId: "d2", turnScopeId: "t2", additional_kwargs: { noobotMessageId: "current-message" } };
  const historyAssistant = { role: "assistant", content: "history", dialogProcessId: "d1" };
  const incrementalUser = { role: "user", content: "current", dialogProcessId: "d2", turnScopeId: "t2", additional_kwargs: { noobotMessageId: "current-message" } };

  const modelState = {
    llm,
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: {},
  };
  const loopState = {
    messages: [duplicateHistoryUser, misplacedSystem, historyAssistant, system, incrementalUser],
    messageBlocks: {
      system: [system],
      history: [duplicateHistoryUser, misplacedSystem, historyAssistant],
      incremental: [incrementalUser],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: null,
    currentTurnTasks: null,
    dialogProcessId: "d2",
    maxTurns: 1,
  };

  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });

  assert.deepEqual(
    capturedMessages.map((item) => `${item.role}:${item.content}`),
    ["system:sys", "assistant:history", "user:current"],
  );
});
