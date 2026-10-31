/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveRootSessionId } from "../../src/context/providers/session-tree-resolver.js";
import { resolveAttachments } from "../../src/context/providers/attachment-resolver.js";
import { resolveLongMemory } from "../../src/context/providers/memory-resolver.js";
import { projectSessionRecordsToContextMessages as toConversationMessages } from "@noobot/context-protocol/message/session-projection";
import {
  readContextMessageValue,
  resolveContextMessageKey,
} from "@noobot/context-protocol/message/codec";
import { buildDynamicInfo } from "../../src/context/providers/environment-provider.js";
import {
  TEST_RUNTIME_IDENTITY,
  createTestAttachmentService,
} from "../helpers/test-runtime-context.js";

test("resolveRootSessionId rejects a missing session authority", async () => {
  await assert.rejects(
    resolveRootSessionId({ sessionManager: null, userId: "u1", sessionId: "s1" }),
    /requires sessionManager\.getRootSessionId/,
  );
  await assert.rejects(
    resolveRootSessionId({
      sessionManager: { async getRootSessionId() {} },
      userId: "",
      sessionId: "s1",
    }),
    /requires userId and sessionId/,
  );
});

test("resolveRootSessionId anchors detached sessions at their durable parent", async () => {
  const calls = [];
  const rootSessionId = await resolveRootSessionId({
    sessionManager: {
      async getRootSessionId({ userId, sessionId }) {
        calls.push([userId, sessionId]);
        return "root";
      },
    },
    userId: "u1",
    sessionId: "scoped-detached-session",
    parentSessionId: "branch",
  });
  assert.deepEqual(calls, [["u1", "branch"]]);
  assert.equal(rootSessionId, "root");
});

test("resolveAttachments should bypass ingest when attachment already ingested", async () => {
  let ingestCalled = false;
  const result = await resolveAttachments({
    attachmentService: createTestAttachmentService({
      async ingest() {
        ingestCalled = true;
        return [];
      },
    }),
    userMessageAttachments: [
      {
        attachmentId: "att1",
        attachmentSource: "user",
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
    attachmentService: createTestAttachmentService({
      async ingest(payload = {}) {
        receivedPayload = payload;
        return [{ attachmentId: "att-ingested" }];
      },
    }),
    userMessageAttachments: [{ name: "raw.txt", mimeType: "text/plain", size: 10 }],
    userId: "u1",
    sessionId: "s1",
  });
  assert.equal(receivedPayload.userId, "u1");
  assert.equal(receivedPayload.sessionId, "s1");
  assert.equal(receivedPayload.attachmentSource, "user");
  assert.equal(Object.hasOwn(receivedPayload, "attachmentPolicy"), false);
  assert.deepEqual(result, [{ attachmentId: "att-ingested" }]);
});

test("resolveAttachments preserves canonical attachments and ingests only raw items", async () => {
  let ingestPayload = null;
  const attachmentService = createTestAttachmentService({
    async ingest(payload) {
      ingestPayload = payload;
      return [
        { attachmentId: "canonicalized", sessionId: payload.sessionId, path: "/tmp/new.txt" },
      ];
    },
  });
  const source = [
    {
      attachmentId: "existing",
      sessionId: "s1",
      attachmentSource: "user",
      path: "/tmp/existing.txt",
    },
    { name: "new.txt", type: "text/plain" },
  ];

  const result = await resolveAttachments({
    attachmentService,
    userMessageAttachments: source,
    userId: "u1",
    sessionId: "s1",
  });

  assert.deepEqual(ingestPayload.attachments, [source[1]]);
  assert.deepEqual(
    result.map((attachment) => attachment.attachmentId),
    ["existing", "canonicalized"],
  );
});

test("resolveAttachments does not infer a canonical identity from an incomplete attachment", async () => {
  let ingestCalled = false;
  const result = await resolveAttachments({
    attachmentService: createTestAttachmentService({
      async ingest() {
        ingestCalled = true;
        return [];
      },
    }),
    userMessageAttachments: [
      {
        attachmentId: "existing",
        name: "existing.txt",
        mimeType: "text/plain",
        path: "/tmp/existing.txt",
      },
    ],
    userId: "u1",
    sessionId: "fallback_session",
  });

  assert.equal(ingestCalled, true);
  assert.deepEqual(result, []);
});

test("resolveAttachments reads only userMessageAttachments", async () => {
  let receivedPayload = null;
  const result = await resolveAttachments({
    attachmentService: createTestAttachmentService({
      async ingest(payload = {}) {
        receivedPayload = payload;
        return [{ attachmentId: "att-input" }];
      },
    }),
    userMessageAttachments: [{ name: "input.txt", mimeType: "text/plain", size: 1 }],
    userId: "u1",
    sessionId: "s1",
  });

  assert.equal(receivedPayload.attachments[0].name, "input.txt");
  assert.deepEqual(result, [{ attachmentId: "att-input" }]);
});

test("toConversationMessages preserves model payload fields and attachments", () => {
  const output = toConversationMessages([
    {
      messageUid: "sm_stable_context_message",
      role: "assistant",
      content: "x",
      userName: "admin",
      sessionId: "session-1",
      parentSessionId: "parent-1",
      dialogProcessId: "dlg_1",
      parentDialogProcessId: "parent-dlg-1",
      turnScopeId: "client-turn:1",
      summarized: false,
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "separate_model_relay:planning",
      messageOrigin: "internal",
      pluginMessage: true,
      rawModelContent: [{ type: "text", text: "raw" }],
      modelAdditionalKwargs: { k: 1 },
      modelResponseMetadata: { finish_reason: "tool_calls" },
      attachments: [{ attachmentId: "a1" }],
    },
  ]);
  assert.equal(output.length, 1);
  assert.equal(resolveContextMessageKey(output[0]), "sm_stable_context_message");
  assert.deepEqual(readContextMessageValue(output[0], "rawModelContent"), [
    { type: "text", text: "raw" },
  ]);
  assert.equal(readContextMessageValue(output[0], "dialogProcessId"), "dlg_1");
  assert.equal(readContextMessageValue(output[0], "userName"), "admin");
  assert.equal(readContextMessageValue(output[0], "sessionId"), "session-1");
  assert.equal(readContextMessageValue(output[0], "parentSessionId"), "parent-1");
  assert.equal(readContextMessageValue(output[0], "parentDialogProcessId"), "parent-dlg-1");
  assert.equal(readContextMessageValue(output[0], "turnScopeId"), "client-turn:1");
  assert.equal(readContextMessageValue(output[0], "summarized"), undefined);
  assert.equal(readContextMessageValue(output[0], "injectedMessage"), true);
  assert.equal(readContextMessageValue(output[0], "injectedBy"), "harness-plugin");
  assert.equal(
    readContextMessageValue(output[0], "injectedMessageType"),
    "separate_model_relay:planning",
  );
  assert.equal(readContextMessageValue(output[0], "messageOrigin"), "internal");
  assert.equal(readContextMessageValue(output[0], "userMetaMaterialized"), undefined);
  assert.equal(readContextMessageValue(output[0], "pluginMessage"), true);
  assert.deepEqual(readContextMessageValue(output[0], "modelAdditionalKwargs"), { k: 1 });
  assert.deepEqual(readContextMessageValue(output[0], "modelResponseMetadata"), {
    finish_reason: "tool_calls",
  });
  assert.deepEqual(readContextMessageValue(output[0], "attachments"), [{ attachmentId: "a1" }]);
});

test("resolveLongMemory only reads static long memory payload from memoryService", async () => {
  const longMemory = await resolveLongMemory({
    memoryService: {
      async readLongMemory() {
        return "static-long-memory-only";
      },
    },
    userId: "u1",
  });
  assert.equal(longMemory, "static-long-memory-only");
});

test("buildDynamicInfo exposes safeConfirm in config", () => {
  const dynamic = buildDynamicInfo({
    identity: TEST_RUNTIME_IDENTITY,
    runConfig: {
      safeConfirm: true,
    },
  });
  assert.equal(dynamic.config.safeConfirm, true);
  assert.equal("forceTool" in dynamic.config, false);
  assert.equal("rootSessionId" in dynamic, false);
});
