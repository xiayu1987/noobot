/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext, writeMessageBlocks } from "@noobot/context-protocol";
import { createEmptyHookResult } from "@noobot/hook-protocol";

import { invokeWithToolsTurn as invokeWithToolsTurnProduction } from "../../../src/runtime/turn/turn-executor.js";
import { createTestModelPort, prepareTestTurnExecution } from "./turn-runtime-test-helper.js";

const TEST_MODEL_SPEC = Object.freeze({
  model: "gpt-4o",
  reasoning_effort: "medium",
  tool_reasoning_effort: "medium",
  reasoning_effort_options: ["low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
});

function invokeWithToolsTurn(args = {}) {
  prepareTestTurnExecution(
    args.modelState,
    args.loopState,
    `with-tools-${args.loopState?.dialogProcessId || "turn"}`,
  );
  return invokeWithToolsTurnProduction(args);
}

test("invokeWithToolsTurn reconciles replaced hook messageBlocks before llm invoke", async () => {
  let capturedMessages = [];
  const harnessSystem = { role: "developer", content: "harness-policy" };
  const runtime = {
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "agent.before_llm_call") return createEmptyHookResult(point, ctx);
        writeMessageBlocks(ctx.modelContext, {
          system: [...ctx.modelContext.messageBlocks.system, harnessSystem],
          history: [...ctx.modelContext.messageBlocks.history],
          incremental: [...ctx.modelContext.messageBlocks.incremental],
        });
        return createEmptyHookResult(point, ctx);
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
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
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
  assert.equal(loopState.modelContext.messageBlocks.system.at(-1)?.content, harnessSystem.content);
});

test("invokeWithToolsTurn adopts explicitly scoped hook messages on first stopped-snapshot resume turn", async () => {
  let capturedMessages = [];
  const harnessSystem = {
    role: "developer",
    content: "harness-policy",
    messageUid: "hook-system",
    dialogProcessId: "d-resume",
    turnScopeId: "turn-current",
  };
  const latestGuidance = {
    role: "user",
    content: "latest-guidance",
    messageUid: "latest-guidance",
    injectedMessage: true,
    injectedBy: "noobot-plugin-harness",
    injectedMessageType: "separate_model_relay:guidance",
    dialogProcessId: "d-resume",
    turnScopeId: "turn-current",
  };
  const runtime = {
    resumeFromStoppedSnapshot: true,
    systemRuntime: {},
    hookManager: {
      async emit(point, ctx = {}) {
        if (point !== "agent.before_llm_call") return createEmptyHookResult(point, ctx);
        writeMessageBlocks(ctx.modelContext, {
          system: [...ctx.modelContext.messageBlocks.system, harnessSystem],
          history: [...ctx.modelContext.messageBlocks.history],
          incremental: [...ctx.modelContext.messageBlocks.incremental, latestGuidance],
        });
        return createEmptyHookResult(point, ctx);
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
  const snapshotHistory = {
    role: "assistant",
    content: "snapshot-history",
    dialogProcessId: "d-stopped",
  };
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
    content:
      '[用户元信息]\n{"dialogProcessId":"d-resume","turnScopeId":"turn-current"}\n[/用户元信息]',
    additional_kwargs: {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      noobotInternalMessageType: "user_meta",
    },
  };
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
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
    {
      role: "system",
      content: "snapshot-system",
      dialogProcessId: "",
      turnScopeId: "",
      internalType: "",
    },
    {
      role: "developer",
      content: "harness-policy",
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "",
    },
    {
      role: "assistant",
      content: "snapshot-history",
      dialogProcessId: "d-stopped",
      turnScopeId: "",
      internalType: "",
    },
    {
      role: "user",
      content: "stale-guidance",
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "",
    },
    {
      role: "user",
      content: "resume-user",
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "",
    },
    {
      role: "user",
      content:
        '[用户元信息]\n{"dialogProcessId":"d-resume","turnScopeId":"turn-current"}\n[/用户元信息]',
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "user_meta",
    },
    {
      role: "user",
      content: "latest-guidance",
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      internalType: "",
    },
  ]);
  assert.equal(
    loopState.modelContext.messageBlocks.system.some(
      (message) => message?.content === harnessSystem.content,
    ),
    true,
  );
  assert.equal(
    loopState.modelContext.messageBlocks.incremental.some(
      (message) => message?.content === latestGuidance.content,
    ),
    true,
  );
  assert.equal(
    loopState.modelContext.messageBlocks.incremental.some(
      (message) => message?.content === staleGuidance.content,
    ),
    true,
  );
  assert.equal(
    capturedMessages.some((message) => message?.content === "stale-guidance"),
    true,
  );
});

test("invokeWithToolsTurn does not rehydrate missing blocks from legacy agentContext payload", async () => {
  let capturedMessages = [];
  const runtime = {
    systemRuntime: { sessionId: "s1", dialogProcessId: "d-current" },
    hookManager: {
      async emit(point, ctx = {}) {
        return createEmptyHookResult(point, ctx);
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
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
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
            content: [
              { type: "thinking", thinking: "inspect", signature: "sig_1" },
              { type: "tool_use", id: "call_1", name: "execute_script", input: {} },
            ],
            tool_calls: [{ id: "call_1", name: "execute_script", args: {} }],
            additional_kwargs: {},
            response_metadata: {},
          };
        },
      };
    },
  };

  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime: { systemRuntime: {} },
    eventListener: null,
    abortSignal: null,
    defaultModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messages: [{ role: "user", content: "run tool" }],
    messageBlocks: {
      system: [],
      history: [],
      incremental: [{ role: "user", content: "run tool" }],
    },
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
  assert.deepEqual(result.turnMessageStore.toArray().at(-1).rawModelContent, [
    { type: "thinking", thinking: "inspect", signature: "sig_1" },
    { type: "tool_use", id: "call_1", name: "execute_script", input: {} },
  ]);
  assert.equal(
    assistantToolCall.additional_kwargs.noobotMessageId,
    result.turnMessageStore.toArray().at(-1).messageUid,
  );
});
