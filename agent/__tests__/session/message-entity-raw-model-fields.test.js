/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessageEntity } from "../../src/session/entities.js";

test("normalizeMessageEntity preserves the canonical internal control message type", () => {
  const normalized = normalizeMessageEntity({
    role: "user",
    type: "context_control",
    content: "checkpoint",
    additional_kwargs: { noobotInternalMessageType: "noobot.phase_summary_prompt" },
  });

  assert.equal(normalized.noobotInternalMessageType, "noobot.phase_summary_prompt");
  assert.equal("additional_kwargs" in normalized, false);
});

test("normalizeMessageEntity does not persist heavy raw model fields", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "fallback",
    rawModelContent: [{ type: "text", text: "x", thought_signature: "sig" }],
    modelAdditionalKwargs: { opaque: true, tool_calls: [{ id: "call_1" }] },
    modelResponseMetadata: {
      finish_reason: "tool_calls",
      model_name: "qwen3.6-plus-2026-04-02",
      model_provider: "openai",
      usage: { total_tokens: 1234, prompt_tokens: 1000 },
    },
  });

  assert.equal("rawModelContent" in normalized, false);
  assert.equal("modelAdditionalKwargs" in normalized, false);
  assert.equal("modelResponseMetadata" in normalized, false);
});

test("normalizeMessageEntity persists compact transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer:message-att-1:tool:call-att-1:output:tool_result_text:structured",
    messageId: "message-att-1",
    identity: {
      sessionId: "test-session",
      turnScopeId: "turn-att-1",
      runId: "run-att-1",
      producer: { type: "plugin", id: "harness-plugin" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att_1", sessionId: "test-session", attachmentSource: "model" },
          role: "primary",
          name: "a.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "plugin",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelopes: [envelope],
  });
  assert.equal("transferEnvelopes" in normalized, true);
  assert.deepEqual(normalized.transferEnvelopes, [envelope]);
  assert.equal(
    normalized.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att_1",
  );
});

test("normalizeMessageEntity ignores non-array transferEnvelopes", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    transferEnvelopes: { protocol: "noobot.semantic-transfer" },
  });

  assert.equal("transferEnvelopes" in normalized, false);
});

test("normalizeMessageEntity omits empty attachments", () => {
  const withoutAttachments = normalizeMessageEntity({
    role: "user",
    content: "hello",
  });
  const withEmptyAttachments = normalizeMessageEntity({
    role: "user",
    content: "hello",
    attachments: [],
  });

  assert.equal("attachments" in withoutAttachments, false);
  assert.equal("attachments" in withEmptyAttachments, false);
});

test("normalizeMessageEntity preserves compact non-empty attachments", () => {
  const attachments = [
    {
      attachmentId: "att_1",
      sessionId: "s1",
      attachmentSource: "user",
      name: "a.txt",
      mimeType: "text/plain",
      raw: "drop",
      owner: { type: "plugin", id: "harness-plugin", extra: "drop" },
    },
  ];
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachments,
  });

  assert.deepEqual(normalized.attachments, [
    {
      attachmentId: "att_1",
      sessionId: "s1",
      attachmentSource: "user",
      name: "a.txt",
      mimeType: "text/plain",
      owner: { type: "plugin", id: "harness-plugin" },
    },
  ]);
  assert.equal("attachmentMetas" in normalized, false);
  assert.equal("raw" in normalized.attachments[0], false);
  assert.equal("id" in normalized.attachments[0], false);
  assert.equal("type" in normalized.attachments[0], false);
  assert.equal("source" in normalized.attachments[0], false);
});

test("normalizeMessageEntity preserves user attachment source fields for history rebuild", () => {
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "see attachment",
    attachments: [
      {
        attachmentId: "att_source_1",
        name: "source.md",
        mimeType: "text/markdown",
        attachmentSource: "user",
        sessionId: "s-source",
        path: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
        relativePath: "runtime/attach/scoped/s-source/user/source.md",
        sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
        size: 42,
        isSandbox: true,
        raw: "drop",
      },
    ],
  });

  assert.deepEqual(normalized.attachments, [
    {
      attachmentId: "att_source_1",
      name: "source.md",
      mimeType: "text/markdown",
      size: 42,
      attachmentSource: "user",
      sessionId: "s-source",
      relativePath: "runtime/attach/scoped/s-source/user/source.md",
      sandboxPath: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
      path: "/workspace/primary-user/runtime/attach/scoped/s-source/user/source.md",
      isSandbox: true,
    },
  ]);
  assert.equal("raw" in normalized.attachments[0], false);
});

test("normalizeMessageEntity preserves message-scoped user identity for history rebuild", () => {
  const normalized = normalizeMessageEntity({
    role: "user",
    content: "hello",
    userName: "admin",
    sessionId: "session-history",
    parentSessionId: "parent-history",
    dialogProcessId: "dialog-history",
    parentDialogProcessId: "parent-dialog-history",
    turnScopeId: "turn-history",
    frontendUserMessage: true,
  });

  assert.equal(normalized.userName, "admin");
  assert.equal(normalized.sessionId, "session-history");
  assert.equal(normalized.parentSessionId, "parent-history");
  assert.equal(normalized.dialogProcessId, "dialog-history");
  assert.equal(normalized.parentDialogProcessId, "parent-dialog-history");
  assert.equal(normalized.turnScopeId, "turn-history");
  assert.equal(normalized.frontendUserMessage, true);
});

test("normalizeMessageEntity ignores legacy attachment mirror fields", () => {
  const camelAttachments = [{ attachmentId: "att_camel", filename: "camel.txt" }];
  const snakeAttachments = [{ attachmentId: "att_snake", filename: "snake.txt" }];

  assert.equal(
    "attachments" in
      normalizeMessageEntity({ role: "user", content: "camel", attachmentMetas: camelAttachments }),
    false,
  );
  assert.equal(
    "attachments" in
      normalizeMessageEntity({
        role: "user",
        content: "snake",
        attachment_metas: snakeAttachments,
      }),
    false,
  );
});

test("normalizeMessageEntity preserves thinking timing fields", () => {
  const normalized = normalizeMessageEntity({
    role: "assistant",
    content: "done",
    thinkingStartedAt: " 2026-07-08T10:00:00.000Z ",
    thinkingFinishedAt: " 2026-07-08T10:00:03.500Z ",
  });

  assert.equal(normalized.thinkingStartedAt, "2026-07-08T10:00:00.000Z");
  assert.equal(normalized.thinkingFinishedAt, "2026-07-08T10:00:03.500Z");
});
