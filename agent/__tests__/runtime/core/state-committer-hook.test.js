/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createStateCommitter } from "../../../src/runtime/tool-execution/state-committer.js";
import { createHookManager, HOOK_POINT } from "@noobot/hook-protocol";
import { createModelContext } from "@noobot/context-protocol";

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

function installEmptyMessageEventMaterializer(runtime = {}) {
  runtime.materializePendingCurrentTurnMessageEvents = () => ({
    activityTimeline: [],
    toolTimeline: [],
  });
  return runtime;
}

test("state-committer emits before/after hooks for assistant message commit", async () => {
  const hookCalls = [];
  const hookManager = createHookManager();
  const runtime = installEmptyMessageEventMaterializer({ hookManager });
  const turnMessageStore = createInMemoryTurnStore();

  hookManager.on(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "assistant_message") return;
    hookCalls.push(`before:${ctx.commitType}`);
    ctx.payload.content = `[hooked]${ctx.payload.content}`;
  }, { id: "test.assistant-commit.before" });
  hookManager.on(HOOK_POINT.AGENT.AFTER_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "assistant_message") return;
    hookCalls.push(`after:${ctx.commitType}`);
  }, { id: "test.assistant-commit.after" });

  const committer = createStateCommitter({
    messages: [],
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_1",
    runtime,
  });

  await committer.pushAssistantMessage({
    content: "hello",
    modelAlias: "alias_x",
    modelName: "model_x",
  });

  assert.deepEqual(hookCalls, ["before:assistant_message", "after:assistant_message"]);
  assert.equal(turnMessageStore.items.length, 1);
  assert.equal(turnMessageStore.items[0].role, "assistant");
  assert.equal(turnMessageStore.items[0].content, "[hooked]hello");
});

test("state-committer emits before/after hooks for tool result commit", async () => {
  const hookCalls = [];
  const hookManager = createHookManager();
  const runtime = { hookManager };
  const turnMessageStore = createInMemoryTurnStore();
  const traces = [];
  const messages = [];

  hookManager.on(HOOK_POINT.AGENT.BEFORE_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "tool_result") return;
    hookCalls.push(`before:${ctx.commitType}`);
    ctx.payload.content = "tool_result_overridden_by_hook";
  }, { id: "test.tool-commit.before" });
  hookManager.on(HOOK_POINT.AGENT.AFTER_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "tool_result") return;
    hookCalls.push(`after:${ctx.commitType}`);
  }, { id: "test.tool-commit.after" });

  const committer = createStateCommitter({
    messages,
    traces,
    turnMessageStore,
    dialogProcessId: "dp_2",
    runtime,
  });

  await committer.pushToolResult({
    call: { id: "call_1", name: "demo_tool", args: { x: 1 } },
    toolResultText: "original_tool_result",
  });

  assert.deepEqual(hookCalls, ["before:tool_result", "after:tool_result"]);
  assert.equal(turnMessageStore.items.length, 1);
  assert.equal(turnMessageStore.items[0].role, "tool");
  assert.equal(turnMessageStore.items[0].content, "tool_result_overridden_by_hook");
  assert.match(turnMessageStore.items[0].messageUid, /^sm_/);
  assert.equal(
    turnMessageStore.items[0].messageId,
    turnMessageStore.items[0].messageUid,
  );
  assert.equal(traces.length, 1);
  assert.equal(traces[0].tool, "demo_tool");
  assert.equal(traces[0].result, "tool_result_overridden_by_hook");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "tool_result_overridden_by_hook");
});

test("state-committer checkpoints assistant and tool records with presentation identity", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  let checkpointCount = 0;
  const runtime = {
    systemRuntime: {
      messageEventStream: { activePresentationMessageId: "msg_chat_checkpoint" },
    },
    persistCurrentTurnMessages: async () => { checkpointCount += 1; },
  };
  installEmptyMessageEventMaterializer(runtime);
  const committer = createStateCommitter({
    messages: [],
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_checkpoint",
    runtime,
  });

  await committer.pushAssistantMessage({
    content: "analysis",
    messageId: "msg_model_checkpoint",
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
  assert.equal(turnMessageStore.items[1].presentationMessageId, "msg_chat_checkpoint");
  assert.equal(
    turnMessageStore.items[1].messageId,
    turnMessageStore.items[1].messageUid,
  );
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
    messages: modelContext.messages,
    messageHolder: modelContext,
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_store_tool",
    runtime: {},
  });

  await committer.pushToolResult({
    call: { id: "call_store", name: "demo_tool", args: {} },
    toolResultText: "store_tool_result",
  });

  assert.equal(modelContext.messages.length, 1);
  assert.equal(modelContext.messages[0]?.content, "store_tool_result");
  assert.equal(modelContext.messageBlocks.incremental[0], modelContext.messages[0]);
  assert.equal(
    modelContext.messages[0].additional_kwargs.noobotMessageId,
    turnMessageStore.items[0].messageUid,
  );
  assert.equal(modelContext.messageBlocks.incrementalIds, undefined);
  assert.equal(modelContext.messages[0]?.dialogProcessId, "dp_store_tool");
  assert.equal(modelContext.messages[0]?.turnScopeId, "turn-store-tool");
  assert.equal(turnMessageStore.items[0]?.content, "store_tool_result");
});

test("state-committer stores compact LLM-facing tool result content", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  const messages = [];
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer_compact",
    messageId: "message_compact",
    identity: {
      sessionId: "session_compact",
      turnScopeId: "turn_compact",
      runId: "run_compact",
      producer: { type: "tool", id: "call_compact" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [{
        identity: {
          attachmentId: "att_compact",
          sessionId: "session_compact",
          attachmentSource: "model",
        },
        role: "primary",
        name: "generated.png",
        mimeType: "image/png",
        size: 123,
      }],
    },
    intent: { source: "tool", reason: "generated_media", scenario: "tool", strategy: "tool_result_text" },
    meta: { persisted: true },
  };
  const committer = createStateCommitter({
    messages,
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_compact",
    runtime: {},
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
    version: 2,
    transferId: "transfer_legacy_removed",
    messageId: "message_legacy_removed",
    identity: {
      sessionId: "session_legacy_removed",
      turnScopeId: "turn_legacy_removed",
      runId: "run_legacy_removed",
      producer: { type: "tool", id: "call_legacy_transfer" },
    },
    direction: "output",
    payload: { mode: "direct", content: "already persisted by transfer protocol" },
    intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_result_text" },
    meta: {},
  };
  const committer = createStateCommitter({
    messages: [],
    traces: [],
    turnMessageStore,
    dialogProcessId: "dp_legacy_transfer",
    runtime: {},
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
