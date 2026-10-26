/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext, writeMessageBlocks } from "@noobot/context-protocol";
import {
  readContextMessageValue,
  resolveContextMessageKey,
  writeContextMessageMetadata,
} from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import { createEmptyHookResult } from "@noobot/hook-protocol";

import { invokeWithToolsTurn as invokeWithToolsTurnProduction } from "../../../src/runtime/turn/turn-executor.js";
import { createTestModelPort, prepareTestTurnExecution } from "./turn-runtime-test-helper.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { createCanonicalMessageEventSessionManager } from "../../helpers/canonical-message-event-session-manager.js";

const TEST_MODEL_SPEC = Object.freeze(
  normalizeRuntimeModelSpec({
    model: "gpt-4o",
    reasoning_effort: "medium",
    tool_reasoning_effort: "medium",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort_parameter: "reasoning_effort",
  }),
);

function contextMessage(native = {}, metadata = {}) {
  return writeContextMessageMetadata(
    { ...native },
    { messageUid: createMessageUid(), ...metadata },
  );
}

function invokeWithToolsTurn(turnArgs) {
  prepareTestTurnExecution(
    turnArgs.modelState,
    turnArgs.loopState,
    "presentation-message-filter-cases-b",
  );
  return invokeWithToolsTurnProduction(turnArgs);
}

test("invokeWithToolsTurn reconciles replaced hook messageBlocks before llm invoke", async () => {
  let capturedMessages = [];
  const harnessSystem = contextMessage({ role: "developer", content: "harness-policy" });
  const runtime = createTestRuntimeContext({
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: {
      hookManager: {
        on: () => () => {},
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
    },
  });
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || item.type || "",
            content: item.content,
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const system = contextMessage({ role: "system", content: "constructed-system" });
  const history = contextMessage(
    { role: "assistant", content: "recent-history" },
    { dialogProcessId: "d-old", turnScopeId: "t-old" },
  );
  const current = contextMessage({ role: "user", content: "current-user" });
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [system],
      history: [history],
      incremental: [current],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    maxTurns: 1,
  };

  await invokeWithToolsTurn({
    modelState,
    loopState,
    turn: 1,
  });

  assert.deepEqual(capturedMessages, [
    { role: "system", content: "constructed-system" },
    { role: "developer", content: "harness-policy" },
    { role: "assistant", content: "recent-history" },
    { role: "user", content: "current-user" },
  ]);
  assert.equal(
    modelState.runtime.activeMessageContext.messageBlocks.system.at(-1)?.content,
    harnessSystem.content,
  );
});

test("invokeWithToolsTurn adopts explicitly scoped hook messages on first stopped-snapshot resume turn", async () => {
  let capturedMessages = [];
  const harnessSystem = contextMessage(
    { role: "developer", content: "harness-policy" },
    { dialogProcessId: "d-resume", turnScopeId: "turn-current" },
  );
  const latestGuidance = contextMessage(
    { role: "user", content: "latest-guidance" },
    {
      injectedMessage: true,
      injectedBy: "noobot-plugin-harness",
      injectedMessageType: "separate_model_relay:guidance",
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
    },
  );
  const runtime = createTestRuntimeContext({
    identity: { dialogProcessId: "d-resume", turnScopeId: "turn-current" },
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: {
      hookManager: {
        on: () => () => {},
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
    },
  });
  runtime.resumeFromStoppedSnapshot = true;
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || item.type || "",
            content: item.content,
            dialogProcessId: readContextMessageValue(item, "dialogProcessId") || "",
            turnScopeId: readContextMessageValue(item, "turnScopeId") || "",
            internalType: readContextMessageValue(item, "noobotInternalMessageType") || "",
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };

  const snapshotSystem = contextMessage({ role: "system", content: "snapshot-system" });

  const snapshotHistory = contextMessage(
    { role: "assistant", content: "snapshot-history" },
    { dialogProcessId: "d-stopped", turnScopeId: "turn-stopped" },
  );
  const resumedUser = contextMessage(
    { role: "user", content: "resume-user" },
    { dialogProcessId: "d-resume", turnScopeId: "turn-current" },
  );
  const staleGuidance = contextMessage(
    { role: "user", content: "stale-guidance" },
    {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      injectedMessage: true,
      injectedBy: "noobot-plugin-harness",
      injectedMessageType: "separate_model_relay:guidance",
    },
  );
  const userMeta = contextMessage(
    {
      role: "user",
      content:
        '[用户元信息]\n{"dialogProcessId":"d-resume","turnScopeId":"turn-current"}\n[/用户元信息]',
    },
    {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
      noobotInternalMessageType: "user_meta",
    },
  );
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    traces: [],
    tools: [{ name: "execute_script" }],
    maxTurns: 1,
  };
  modelState.runtime.activeMessageContext = createModelContext({
    messageBlocks: {
      system: [snapshotSystem],
      history: [snapshotHistory],
      incremental: [staleGuidance, resumedUser, userMeta],
    },
    activeTurnIdentity: {
      dialogProcessId: "d-resume",
      turnScopeId: "turn-current",
    },
  });

  await invokeWithToolsTurn({
    modelState,
    loopState,
    turn: 1,
  });

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
      turnScopeId: "turn-stopped",
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
    modelState.runtime.activeMessageContext.messageBlocks.system.some(
      (message) => message?.content === harnessSystem.content,
    ),
    true,
  );
  assert.equal(
    modelState.runtime.activeMessageContext.messageBlocks.incremental.some(
      (message) => message?.content === latestGuidance.content,
    ),
    true,
  );
  assert.equal(
    modelState.runtime.activeMessageContext.messageBlocks.incremental.some(
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
  const runtime = createTestRuntimeContext({
    sessionManager: createCanonicalMessageEventSessionManager(),
    runConfig: {
      hookManager: {
        on: () => () => {},
        async emit(point, ctx = {}) {
          return createEmptyHookResult(point, ctx);
        },
      },
    },
  });
  const llm = {
    bindTools() {
      return {
        async invoke(messages) {
          capturedMessages = (Array.isArray(messages) ? messages : []).map((item) => ({
            role: item.role || item.type || "",
            content: item.content,
          }));
          return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
        },
      };
    },
  };
  const current = contextMessage({ role: "user", content: "current-user" });
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime,
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [current],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    maxTurns: 1,
  };

  await invokeWithToolsTurn({
    modelState,
    loopState,
    turn: 1,
  });

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
    runtime: createTestRuntimeContext({
      sessionManager: createCanonicalMessageEventSessionManager(),
    }),
    eventListener: null,
    abortSignal: null,
    activeModelSpec: TEST_MODEL_SPEC,
  };
  const loopState = {
    messageBlocks: {
      system: [],
      history: [],
      incremental: [contextMessage({ role: "user", content: "run tool" })],
    },
    traces: [],
    tools: [{ name: "execute_script" }],
    maxTurns: 1,
  };

  const result = await invokeWithToolsTurn({
    modelState,
    loopState,
    turn: 1,
  });

  assert.equal(result.calls.length, 1);
  const assistantToolCall = modelState.runtime.activeMessageContext.messages.at(-1);
  assert.equal(Array.isArray(assistantToolCall.tool_calls), true);
  assert.equal(
    modelState.runtime.activeMessageContext.messageBlocks.incremental.at(-1),
    assistantToolCall,
  );
  assert.deepEqual(result.turnMessageStore.toArray().at(-1).rawModelContent, [
    { type: "thinking", thinking: "inspect", signature: "sig_1" },
    { type: "tool_use", id: "call_1", name: "execute_script", input: {} },
  ]);
  assert.equal(
    resolveContextMessageKey(assistantToolCall),
    result.turnMessageStore.toArray().at(-1).messageUid,
  );
});
