/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMessageEntity } from "../../src/session/entities.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("normalizeMessageEntity preserves the canonical internal control message type", () => {
  const normalized = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_17",
    ts: TEST_MESSAGE_TS,
    role: "user",
    injectedMessage: true,
    type: "context_control",
    chatPresentation: false,
    content: "checkpoint",
    noobotInternalMessageType: "noobot.phase_summary_prompt",

    additional_kwargs: { noobotInternalMessageType: "noobot.legacy_prompt" },
  });

  assert.equal(normalized.noobotInternalMessageType, "noobot.phase_summary_prompt");
  assert.equal(normalized.chatPresentation, false);
  assert.equal("additional_kwargs" in normalized, false);
});

test("normalizeMessageEntity preserves canonical user interjection ordering", () => {
  const normalized = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_18",
    role: "user",
    type: "message",
    content: "accepted constraint",
    injectedMessage: true,
    injectedMessageType: "noobot.user_interjection",
    interjectionSequence: 2,
    ts: "2026-09-18T01:00:00.000Z",
  });

  assert.equal(normalized.interjectionSequence, 2);
  assert.equal(normalized.ts, "2026-09-18T01:00:00.000Z");
});

test("normalizeMessageEntity persists assistant protocol blocks but not diagnostics", () => {
  const normalized = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_19",
    ts: TEST_MESSAGE_TS,
    modelMessageId: "mm_fixture_19",
    role: "assistant",
    presentationMessageId: "pm_fx1",
    content: "fallback",
    rawModelContent: [{ type: "text", text: "x", thought_signature: "sig" }],
    modelAdditionalKwargs: {
      reasoning: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
      opaque: true,
    },
    modelResponseMetadata: {
      output: [{ id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] }],
      finish_reason: "tool_calls",
      model_name: "qwen3.6-plus-2026-04-02",
      model_provider: "openai",
      usage: { total_tokens: 1234, prompt_tokens: 1000 },
    },
  });

  assert.deepEqual(normalized.rawModelContent, [
    { type: "text", text: "x", thought_signature: "sig" },
  ]);
  assert.notEqual(normalized.rawModelContent, normalized.content);
  assert.deepEqual(normalized.modelAdditionalKwargs, {
    reasoning: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] },
  });
  assert.deepEqual(normalized.modelResponseMetadata, {
    output: [{ id: "rs_1", type: "reasoning", encrypted_content: "encrypted", summary: [] }],
  });
});

test("normalizeMessageEntity persists compact transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:message-att-1:tool:call-att-1:output:tool_result_text:structured",
    presentationMessageId: "message-att-1",
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
    sessionId: "s_fixture",
    messageUid: "sm_fixture_20",
    ts: TEST_MESSAGE_TS,
    modelMessageId: "mm_fixture_20",
    role: "assistant",
    presentationMessageId: "pm_fx2",
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

test("normalizeMessageEntity rejects invalid transferEnvelopes", () => {
  assert.throws(
    () =>
      normalizeMessageEntity({
        sessionId: "s_fixture",
        messageUid: "sm_fixture_21",
        ts: TEST_MESSAGE_TS,
        modelMessageId: "mm_fixture_21",
        role: "assistant",
        presentationMessageId: "pm_fx3",
        content: "done",
        transferEnvelopes: { protocol: "noobot.semantic-transfer" },
      }),
    /invalid_transfer_envelope:invalid_version/,
  );
});

test("normalizeMessageEntity always projects attachments as an array", () => {
  const withoutAttachments = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_22",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
    content: "hello",
  });
  const withEmptyAttachments = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_23",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
    content: "hello",
    attachments: [],
  });

  assert.deepEqual(withoutAttachments.attachments, []);
  assert.deepEqual(withEmptyAttachments.attachments, []);
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
    sessionId: "s_fixture",
    messageUid: "sm_fixture_24",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
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
    sessionId: "s_fixture",
    messageUid: "sm_fixture_25",
    ts: TEST_MESSAGE_TS,
    role: "user",
    messageOrigin: "natural",
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
        sourcePath: "D:/work/source.md",
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
      sourcePath: "D:/work/source.md",
    },
  ]);
  assert.equal("raw" in normalized.attachments[0], false);
  assert.equal("isSandbox" in normalized.attachments[0], false);
});

test("normalizeMessageEntity preserves message-scoped user identity for history rebuild", () => {
  const normalized = normalizeMessageEntity({
    role: "user",
    messageUid: "sm_history",
    ts: TEST_MESSAGE_TS,
    content: "hello",
    userName: "admin",
    sessionId: "session-history",
    parentSessionId: "parent-history",
    dialogProcessId: "dialog-history",
    parentDialogProcessId: "parent-dialog-history",
    turnScopeId: "turn-history",
    messageOrigin: "natural",
  });

  assert.equal(normalized.userName, "admin");
  assert.equal(normalized.sessionId, "session-history");
  assert.equal(normalized.parentSessionId, "parent-history");
  assert.equal(normalized.dialogProcessId, "dialog-history");
  assert.equal(normalized.parentDialogProcessId, "parent-dialog-history");
  assert.equal(normalized.turnScopeId, "turn-history");
  assert.equal(normalized.messageOrigin, "natural");
  assert.equal("userMetaMaterialized" in normalized, false);
});

test("normalizeMessageEntity ignores legacy attachment mirror fields", () => {
  const camelAttachments = [{ attachmentId: "att_camel", filename: "camel.txt" }];
  const snakeAttachments = [{ attachmentId: "att_snake", filename: "snake.txt" }];

  assert.deepEqual(
    normalizeMessageEntity({
      sessionId: "s_fixture",
      messageUid: "sm_fixture_27",
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      content: "camel",
      attachmentMetas: camelAttachments,
    }).attachments,
    [],
  );
  assert.deepEqual(
    normalizeMessageEntity({
      sessionId: "s_fixture",
      messageUid: "sm_fixture_28",
      ts: TEST_MESSAGE_TS,
      role: "user",
      messageOrigin: "natural",
      content: "snake",
      attachment_metas: snakeAttachments,
    }).attachments,
    [],
  );
});

test("normalizeMessageEntity drops thinking timing fields owned by turn facts", () => {
  const normalized = normalizeMessageEntity({
    sessionId: "s_fixture",
    messageUid: "sm_fixture_29",
    ts: TEST_MESSAGE_TS,
    modelMessageId: "mm_fixture_29",
    role: "assistant",
    presentationMessageId: "pm_fx4",
    content: "done",
    thinkingStartedAt: " 2026-07-08T10:00:00.000Z ",
    thinkingFinishedAt: " 2026-07-08T10:00:03.500Z ",
  });

  assert.equal(Object.hasOwn(normalized, "thinkingStartedAt"), false);
  assert.equal(Object.hasOwn(normalized, "thinkingFinishedAt"), false);
});
