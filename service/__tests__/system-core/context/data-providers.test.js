import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveSessionTreeWithRootSessionId,
  resolveAttachments,
  resolveLongMemory,
  toConversationMessages,
} from "../../../system-core/context/data-providers.js";

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
    attachmentMetas: [
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
    attachmentMetas: [{ name: "raw.txt", mimeType: "text/plain", size: 10 }],
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(receivedPayload.userId, "u1");
  assert.equal(receivedPayload.sessionId, "s1");
  assert.equal(receivedPayload.attachmentSource, "user");
  assert.deepEqual(receivedPayload.attachmentPolicy, { maxFileCount: 3 });
  assert.deepEqual(result, [{ attachmentId: "att-ingested" }]);
});

test("toConversationMessages preserves model payload fields and attachment fallback", () => {
  const output = toConversationMessages([
    {
      role: "assistant",
      content: "x",
      rawModelContent: [{ type: "text", text: "raw" }],
      modelAdditionalKwargs: { k: 1 },
      modelResponseMetadata: { finish_reason: "tool_calls" },
      attachments: [{ attachmentId: "a1" }],
    },
  ]);
  assert.equal(output.length, 1);
  assert.deepEqual(output[0].rawModelContent, [{ type: "text", text: "raw" }]);
  assert.deepEqual(output[0].modelAdditionalKwargs, { k: 1 });
  assert.deepEqual(output[0].modelResponseMetadata, { finish_reason: "tool_calls" });
  assert.deepEqual(output[0].attachmentMetas, [{ attachmentId: "a1" }]);
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
