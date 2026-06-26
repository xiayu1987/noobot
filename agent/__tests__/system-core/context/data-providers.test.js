import test from "node:test";
import assert from "node:assert/strict";

import { resolveSessionTreeWithRootSessionId } from "../../../src/system-core/context/providers/session-tree-resolver.js";
import { resolveAttachments } from "../../../src/system-core/context/providers/attachment-resolver.js";
import { resolveLongMemory } from "../../../src/system-core/context/providers/memory-resolver.js";
import { toConversationMessages } from "../../../src/system-core/context/session/message-converter.js";
import { buildDynamicInfo } from "../../../src/system-core/context/providers/environment-provider.js";

test("resolveSessionTreeWithRootSessionId falls back when runtime/sessionManager missing", async () => {
  const now = "2026-05-13T00:00:00.000Z";
  const result = await resolveSessionTreeWithRootSessionId({
    runtimeBasePath: "",
    sessionManager: null,
    userId: "u1",
    sessionId: "s1",
    now,
  });
  assert.deepEqual(result, {
    sessionTree: { roots: [], nodes: {}, updatedAt: now },
    rootSessionId: "s1",
  });
});

test("resolveSessionTreeWithRootSessionId reads sessionTree and root from sessionManager", async () => {
  const result = await resolveSessionTreeWithRootSessionId({
    runtimeBasePath: "/workspace/u1",
    sessionManager: {
      async getSessionTree({ userId }) {
        assert.equal(userId, "u1");
        return { roots: ["root"], nodes: { root: { sessionId: "root" } } };
      },
      async getRootSessionId({ userId, sessionId }) {
        assert.equal(userId, "u1");
        assert.equal(sessionId, "s2");
        return "root";
      },
    },
    userId: "u1",
    sessionId: "s2",
  });
  assert.equal(result.rootSessionId, "root");
  assert.equal(result.sessionTree.roots[0], "root");
});

test("resolveAttachments should bypass ingest when attachment already ingested", async () => {
  let ingestCalled = false;
  const result = await resolveAttachments({
    attachmentService: {
      async ingest() {
        ingestCalled = true;
        return [];
      },
    },
    runtimeBasePath: "/workspace/u1",
    attachments: [
      {
        attachmentId: "att1",
        path: "/workspace/u1/runtime/attach/scoped/s1/user/att1.png",
        sessionId: "s1",
        name: "a.png",
        mimeType: "image/png",
        size: "123",
      },
    ],
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(ingestCalled, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].attachmentId, "att1");
  assert.equal(result[0].size, 123);
});

test("resolveAttachments should call ingest when attachments are raw", async () => {
  let receivedPayload = null;
  const result = await resolveAttachments({
    attachmentService: {
      async ingest(payload = {}) {
        receivedPayload = payload;
        return [{ attachmentId: "att-ingested" }];
      },
    },
    runtimeBasePath: "/workspace/u1",
    effectiveConfig: {
      attachments: { maxFileCount: 3 },
    },
    attachments: [{ name: "raw.txt", mimeType: "text/plain", size: 10 }],
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(receivedPayload.userId, "u1");
  assert.equal(receivedPayload.sessionId, "s1");
  assert.equal(receivedPayload.attachmentSource, "user");
  assert.deepEqual(receivedPayload.attachmentPolicy, { maxFileCount: 3 });
  assert.deepEqual(result, [{ attachmentId: "att-ingested" }]);
});

test("resolveAttachments prefers inputAttachments over attachments", async () => {
  let receivedPayload = null;
  const result = await resolveAttachments({
    attachmentService: {
      async ingest(payload = {}) {
        receivedPayload = payload;
        return [{ attachmentId: "att-input" }];
      },
    },
    runtimeBasePath: "/workspace/u1",
    inputAttachments: [{ name: "input.txt", mimeType: "text/plain", size: 1 }],
    attachments: [{ name: "fallback.txt", mimeType: "text/plain", size: 1 }],
    userId: "u1",
    sessionId: "s1",
  });

  assert.equal(receivedPayload.attachments[0].name, "input.txt");
  assert.deepEqual(result, [{ attachmentId: "att-input" }]);
});

test("toConversationMessages preserves model payload fields and attachments", () => {
  const output = toConversationMessages([
    {
      role: "assistant",
      content: "x",
      dialogProcessId: "dlg_1",
      turnScopeId: "client-turn:1",
      summarized: false,
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:planning",
      frontendUserMessage: true,
      pluginMessage: true,
      rawModelContent: [{ type: "text", text: "raw" }],
      modelAdditionalKwargs: { k: 1 },
      modelResponseMetadata: { finish_reason: "tool_calls" },
      attachments: [{ attachmentId: "a1" }],
    },
  ]);
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].rawModelContent, [{ type: "text", text: "raw" }]);
  assert.equal(output[0].dialogProcessId, "dlg_1");
  assert.equal(output[0].turnScopeId, "client-turn:1");
  assert.equal(output[0].summarized, false);
  assert.equal(output[0].injectedMessage, true);
  assert.equal(output[0].injectedBy, "harness-plugin");
  assert.equal(output[0].injectedMessageType, "separate_model_relay:planning");
  assert.equal(output[0].frontendUserMessage, true);
  assert.equal(output[0].pluginMessage, true);
  assert.deepEqual(output[0].modelAdditionalKwargs, { k: 1 });
  assert.deepEqual(output[0].modelResponseMetadata, { finish_reason: "tool_calls" });
  assert.deepEqual(output[0].attachments, [{ attachmentId: "a1" }]);
});

test("resolveLongMemory only reads static long memory payload from memoryService", async () => {
  const longMemory = await resolveLongMemory({
    memoryService: {
      async readLongMemory() {
        return "static-long-memory-only";
      },
    },
    runtimeBasePath: "/workspace/u1",
    userId: "u1",
  });
  assert.equal(longMemory, "static-long-memory-only");
});

test("buildDynamicInfo only exposes canonical forceTool in config", () => {
  const dynamic = buildDynamicInfo({
    runConfig: {
      forceTool: true,
    },
  });
  assert.equal(dynamic.config.forceTool, true);
  assert.equal("forceToolCall" in dynamic.config, false);
});
