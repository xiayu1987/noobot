import test from "node:test";
import assert from "node:assert/strict";

import { createStateCommitter } from "../../../../src/system-core/agent/core/execution/state-committer.js";
import { createAgentHookManager, AGENT_HOOK_POINTS } from "../../../../src/system-core/hook/index.js";

function createInMemoryTurnStore() {
  return {
    items: [],
    push(item = {}) {
      this.items.push(item);
    },
    toArray() {
      return this.items.slice();
    },
  };
}

test("state-committer emits before/after hooks for assistant message commit", async () => {
  const hookCalls = [];
  const hookManager = createAgentHookManager();
  const runtime = { hookManager };
  const turnMessageStore = createInMemoryTurnStore();

  hookManager.on(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "assistant_message") return;
    hookCalls.push(`before:${ctx.commitType}`);
    ctx.payload.content = `[hooked]${ctx.payload.content}`;
  });
  hookManager.on(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "assistant_message") return;
    hookCalls.push(`after:${ctx.commitType}`);
  });

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
  const hookManager = createAgentHookManager();
  const runtime = { hookManager };
  const turnMessageStore = createInMemoryTurnStore();
  const traces = [];
  const messages = [];

  hookManager.on(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "tool_result") return;
    hookCalls.push(`before:${ctx.commitType}`);
    ctx.payload.content = "tool_result_overridden_by_hook";
  });
  hookManager.on(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "tool_result") return;
    hookCalls.push(`after:${ctx.commitType}`);
  });

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
  assert.equal(traces.length, 1);
  assert.equal(traces[0].tool, "demo_tool");
  assert.equal(traces[0].result, "tool_result_overridden_by_hook");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "tool_result_overridden_by_hook");
});

test("state-committer stores compact LLM-facing tool result content", async () => {
  const turnMessageStore = createInMemoryTurnStore();
  const messages = [];
  const attachmentMeta = {
    attachmentId: "att_compact",
    name: "generated.png",
    mimeType: "image/png",
    path: "/host/generated.png",
    relativePath: "runtime/attach/generated.png",
    generatedByModel: true,
    generationSource: "multimodal_generate_tool",
  };
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/generated.png",
    attachmentMeta,
    files: [{ filePath: "/workspace/generated.png", attachmentMeta }],
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
    toolResultText: JSON.stringify({
      toolName: "multimodal_generate",
      ok: true,
      attachmentMetas: [attachmentMeta],
      transferResult: { ok: true, status: "file", envelope },
      transferEnvelope: envelope,
      transferEnvelopes: [envelope],
    }),
  });

  const payload = JSON.parse(messages[0].content);
  assert.equal("transferResult" in payload, false);
  assert.equal("transferEnvelope" in payload, false);
  assert.equal("transferEnvelopes" in payload, false);
  assert.equal("attachmentMetas" in payload, false);
  assert.equal(payload.transferFiles[0].attachmentId, "att_compact");
  assert.equal("transferEnvelope" in turnMessageStore.items[0], false);
  assert.equal("transferEnvelopes" in turnMessageStore.items[0], false);
});

test("state-committer emits before/after hooks for attachment meta commit", async () => {
  const hookCalls = [];
  const hookManager = createAgentHookManager();
  const runtime = { hookManager, attachmentMetas: [] };
  const turnMessageStore = createInMemoryTurnStore();

  hookManager.on(AGENT_HOOK_POINTS.BEFORE_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "attachment_metas") return;
    hookCalls.push(`before:${ctx.commitType}`);
    ctx.payload.attachmentMetas.push({
      attachmentId: "att_2",
      name: "b.png",
      mimeType: "image/png",
    });
  });
  hookManager.on(AGENT_HOOK_POINTS.AFTER_STATE_COMMIT, async (ctx = {}) => {
    if (ctx.commitType !== "attachment_metas") return;
    hookCalls.push(`after:${ctx.commitType}`);
  });

  const committer = createStateCommitter({
    turnMessageStore,
    dialogProcessId: "dp_3",
    runtime,
  });

  await committer.appendAttachmentMetas([
    {
      attachmentId: "att_1",
      name: "a.png",
      mimeType: "image/png",
    },
  ]);

  assert.deepEqual(hookCalls, ["before:attachment_metas", "after:attachment_metas"]);
  assert.equal(Array.isArray(runtime.attachmentMetas), true);
  assert.equal(runtime.attachmentMetas.length, 2);
  assert.deepEqual(
    runtime.attachmentMetas.map((item) => item.attachmentId),
    ["att_1", "att_2"],
  );
});
