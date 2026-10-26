/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { createStateCommitter } from "../../../src/runtime/tool-execution/state-committer.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { bindAssistantMessageEventStream } from "../../../src/events/message-event-stream.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createModelContext } from "@noobot/context-protocol";
import { createMessageUid } from "@noobot/session-protocol/message-identity";
import {
  readContextMessageValue,
  resolveContextMessageKey,
} from "@noobot/context-protocol/message/codec";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";

function createInMemoryTurnStore() {
  return {
    items: [],
    push(item = {}) {
      this.items.push(item);
    },
    updateLast(item = {}) {
      if (!this.items.length) {
        this.items.push(item);
        return;
      }
      this.items[this.items.length - 1] = item;
    },
    toArray() {
      return this.items.slice();
    },
  };
}

function createUpdatableTurnStore() {
  return {
    items: [],
    push(item = {}) {
      this.items.push(item);
    },
    updateWhere(patch = {}, matcher = () => true) {
      let count = 0;
      for (const item of this.items) {
        if (!matcher(item)) continue;
        Object.assign(item, patch);
        count += 1;
      }
      return count;
    },
    toArray() {
      return this.items.slice();
    },
  };
}

function createTestRuntime({ persistCurrentTurnMessages = async () => {}, ...factoryInput } = {}) {
  const runtime = createTestRuntimeContext(factoryInput);
  runtime.persistCurrentTurnMessages = persistCurrentTurnMessages;
  return runtime;
}

function installEmptyMessageEventMaterializer(runtime) {
  runtime.materializePendingCurrentTurnMessageEvents = () => ({
    activityTimeline: [],
    toolTimeline: [],
  });
  return runtime;
}

function createTestModelContext(dialogProcessId = "d-test", turnScopeId = "t-test") {
  return createModelContext({
    activeTurnIdentity: { dialogProcessId, turnScopeId },
    messageBlocks: { system: [], history: [], incremental: [] },
  });
}

test("state-committer emits before/after hooks for assistant message commit", async () => {
  const hookCalls = [];
  const hookManager = createHookManager();
  const runtime = installEmptyMessageEventMaterializer(
    createTestRuntime({ runConfig: { hookManager } }),
  );
  const turnMessageStore = createInMemoryTurnStore();

  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
    async (ctx = {}) => {
      if (ctx.commitType !== "assistant_message") return;
      hookCalls.push(`before:${ctx.commitType}`);
      ctx.payload.content = `[hooked]${ctx.payload.content}`;
    },
    { id: "test.assistant-commit.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
    async (ctx = {}) => {
      if (ctx.commitType !== "assistant_message") return;
      hookCalls.push(`after:${ctx.commitType}`);
    },
    { id: "test.assistant-commit.after" },
  );

  const committer = createStateCommitter({
    messages: [],
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_1",
    runtime,
  });

  await committer.pushAssistantMessage({
    content: "hello",
    messageUid: createMessageUid(),
    modelAlias: "alias_x",
    modelName: "model_x",
  });

  assert.deepEqual(hookCalls, ["before:assistant_message", "after:assistant_message"]);
  assert.equal(turnMessageStore.items.length, 1);
  assert.equal(turnMessageStore.items[0].role, "assistant");
  assert.equal(turnMessageStore.items[0].content, "[hooked]hello");
});

test("state-committer keeps one canonical assistant presentation per Turn", async () => {
  const turnMessageStore = createUpdatableTurnStore();
  const runtime = installEmptyMessageEventMaterializer(
    createTestRuntime({
      identity: { turnScopeId: "turn-canonical" },
      persistCurrentTurnMessages: async () => {},
    }),
  );
  const committer = createStateCommitter({
    turnMessageStore,
    dialogProcessId: "dialog-canonical",
    runtime,
  });

  await committer.pushAssistantMessage({
    content: "first",
    messageUid: createMessageUid(),
    presentationMessageId: "presentation-canonical",
    chatPresentation: true,
  });
  await committer.pushAssistantMessage({
    content: "second",
    messageUid: createMessageUid(),
    presentationMessageId: "presentation-canonical",
    chatPresentation: true,
  });

  assert.deepEqual(
    turnMessageStore.items.map((message) => message.chatPresentation),
    [false, true],
  );
});

test("state-committer emits before/after hooks for tool result commit", async () => {
  const hookCalls = [];
  const hookManager = createHookManager();
  const runtime = createTestRuntime({ runConfig: { hookManager } });
  const turnMessageStore = createInMemoryTurnStore();
  const traces = [];
  const modelContext = createTestModelContext("dp_2", "turn-dp-2");
  const messages = modelContext.messages;

  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
    async (ctx = {}) => {
      if (ctx.commitType !== "tool_result") return;
      hookCalls.push(`before:${ctx.commitType}`);
      ctx.payload.content = "tool_result_overridden_by_hook";
    },
    { id: "test.tool-commit.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
    async (ctx = {}) => {
      if (ctx.commitType !== "tool_result") return;
      hookCalls.push(`after:${ctx.commitType}`);
    },
    { id: "test.tool-commit.after" },
  );

  const committer = createStateCommitter({
    modelContext,
    traces,
    turnMessageStore,
    dialogProcessId: "dp_2",
    runtime,
  });

  const contextPolicy = createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE);
  await committer.pushToolResult({
    call: { id: "call_1", name: "demo_tool", args: { x: 1 }, contextPolicy },
    toolResultText: "original_tool_result",
  });

  assert.deepEqual(hookCalls, ["before:tool_result", "after:tool_result"]);
  assert.equal(turnMessageStore.items.length, 1);
  assert.equal(turnMessageStore.items[0].role, "tool");
  assert.equal(turnMessageStore.items[0].content, "tool_result_overridden_by_hook");
  assert.deepEqual(turnMessageStore.items[0].contextPolicy, contextPolicy);
  assert.match(turnMessageStore.items[0].messageUid, /^sm_/);
  assert.equal(Object.hasOwn(turnMessageStore.items[0], "messageId"), false);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].tool, "demo_tool");
  assert.equal(traces[0].result, "tool_result_overridden_by_hook");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "tool_result_overridden_by_hook");
  assert.deepEqual(readContextMessageValue(messages[0], "contextPolicy"), contextPolicy);
});

test("state-committer completes tool result hooks and commit after the parent Turn is stopped", async () => {
  const hookCalls = [];
  const hookManager = createHookManager();
  const abortController = new AbortController();
  abortController.abort({ type: "user_stop", reason: "user stop action" });
  const runtime = createTestRuntime({
    runConfig: { hookManager },
    abortSignal: abortController.signal,
  });
  const turnMessageStore = createInMemoryTurnStore();
  const modelContext = createTestModelContext("dp_stopped", "turn-stopped");

  hookManager.on(
    HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
    (_context, invocation) => {
      hookCalls.push(`before:${invocation.signal.aborted}`);
    },
    { id: "test.stopped-tool-commit.before" },
  );
  hookManager.on(
    HOOK_POINT.AGENT.AFTER_STATE_COMMIT,
    (_context, invocation) => {
      hookCalls.push(`after:${invocation.signal.aborted}`);
    },
    { id: "test.stopped-tool-commit.after" },
  );

  const committer = createStateCommitter({
    modelContext,
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_stopped",
    runtime,
  });
  await committer.pushToolResult({
    call: { id: "call_stopped", name: "execute_script", args: {} },
    toolResultText: JSON.stringify({ ok: false, status: "aborted" }),
  });

  assert.deepEqual(hookCalls, ["before:false", "after:false"]);
  assert.equal(modelContext.messageBlocks.incremental.length, 1);
  assert.equal(modelContext.messages[0].tool_call_id, "call_stopped");
  assert.equal(turnMessageStore.items[0].tool_call_id, "call_stopped");
});

test("state-committer checkpoints assistant and tool records with presentation identity", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  let checkpointCount = 0;
  const runtime = installEmptyMessageEventMaterializer(
    createTestRuntime({
      persistCurrentTurnMessages: async () => {
        checkpointCount += 1;
      },
    }),
  );
  bindAssistantMessageEventStream(runtime, {
    presentationMessageId: "msg_chat_checkpoint",
    parentSessionId: "",
    workflowRunId: "",
    nodeExecutionId: "",
  });
  const committer = createStateCommitter({
    modelContext: createTestModelContext("dp_checkpoint", "turn-checkpoint"),
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_checkpoint",
    runtime,
  });

  await committer.pushAssistantMessage({
    content: "analysis",
    messageUid: createMessageUid(),
    presentationMessageId: "msg_chat_checkpoint",
    type: "tool_call",
  });
  await committer.pushToolResult({
    call: { id: "call_checkpoint", name: "demo_tool" },
    toolResultText: "done",
  });

  assert.equal(checkpointCount, 2);
  assert.equal(turnMessageStore.items[0].presentationMessageId, "msg_chat_checkpoint");
  assert.equal(turnMessageStore.items[0].chatPresentation, false);
  assert.equal(turnMessageStore.items[0].activityTimeline, undefined);
  assert.equal(turnMessageStore.items[1].presentationMessageId, "msg_chat_checkpoint");
  assert.equal(Object.hasOwn(turnMessageStore.items[1], "messageId"), false);
});

test("state-committer writes tool result through message store when holder is provided", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  const modelContext = createModelContext({
    activeTurnIdentity: {
      dialogProcessId: "dp_store_tool",
      turnScopeId: "turn-store-tool",
    },
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  const committer = createStateCommitter({
    modelContext,
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_store_tool",
    runtime: createTestRuntime(),
  });

  await committer.pushToolResult({
    call: { id: "call_store", name: "demo_tool", args: {} },
    toolResultText: "store_tool_result",
  });

  assert.equal(modelContext.messages.length, 1);
  assert.equal(modelContext.messages[0]?.content, "store_tool_result");
  assert.equal(modelContext.messageBlocks.incremental[0], modelContext.messages[0]);
  assert.equal(
    resolveContextMessageKey(modelContext.messages[0]),
    turnMessageStore.items[0].messageUid,
  );
  assert.equal(modelContext.messageBlocks.incrementalIds, undefined);
  assert.equal(
    readContextMessageValue(modelContext.messages[0], "dialogProcessId"),
    "dp_store_tool",
  );
  assert.equal(readContextMessageValue(modelContext.messages[0], "turnScopeId"), "turn-store-tool");
  assert.equal(turnMessageStore.items[0]?.content, "store_tool_result");
});

test("state-committer stores compact LLM-facing tool result content", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  const modelContext = createTestModelContext("dp_compact", "turn-compact");
  const messages = modelContext.messages;
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer_compact",
    presentationMessageId: "message_compact",
    identity: {
      sessionId: "session_compact",
      turnScopeId: "turn_compact",
      runId: "run_compact",
      producer: { type: "tool", id: "call_compact" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: {
            attachmentId: "att_compact",
            sessionId: "session_compact",
            attachmentSource: "model",
          },
          role: "primary",
          name: "generated.png",
          mimeType: "image/png",
          size: 123,
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "generated_media",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
  const committer = createStateCommitter({
    modelContext,
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_compact",
    runtime: createTestRuntime(),
  });

  await committer.pushToolResult({
    call: { id: "call_compact", name: "multimodal_generate", args: {} },
    toolResultText: JSON.stringify({ toolName: "multimodal_generate", ok: true }),
    transferEnvelopes: [envelope],
  });

  const payload = JSON.parse(messages[0].content);
  assert.equal("transferResult" in payload, false);
  assert.equal("attachmentMetas" in payload, false);
  assert.equal(payload.toolName, "multimodal_generate");
  assert.equal("transferEnvelopes" in payload, false);
  assert.equal("transferEnvelopes" in turnMessageStore.items[0], true);
  assert.deepEqual(turnMessageStore.items[0].transferEnvelopes, [envelope]);
});

test("state-committer persists transferEnvelopes only", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer_legacy_removed",
    presentationMessageId: "message_legacy_removed",
    identity: {
      sessionId: "session_legacy_removed",
      turnScopeId: "turn_legacy_removed",
      runId: "run_legacy_removed",
      producer: { type: "tool", id: "call_legacy_transfer" },
    },
    direction: "output",
    payload: { mode: "direct", content: "already persisted by transfer protocol" },
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {},
  };
  const committer = createStateCommitter({
    modelContext: createTestModelContext("dp_legacy_transfer", "turn-legacy-transfer"),
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_legacy_transfer",
    runtime: createTestRuntime(),
  });

  await committer.pushToolResult({
    call: { id: "call_legacy_transfer", name: "legacy_transfer_tool", args: {} },
    toolResultText: "tool result",
    transferEnvelopes: [envelope],
  });

  assert.equal("transferResult" in turnMessageStore.items[0], false);
  assert.equal("transferEnvelopes" in turnMessageStore.items[0], true);
  assert.deepEqual(turnMessageStore.items[0].transferEnvelopes, [envelope]);
});
