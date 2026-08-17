/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeContextTransferEnvelopes,
  projectSessionRecordToContextMessage,
  projectSessionRecordsToContextMessages,
} from "../src/message/session-projection.js";

function transferEnvelope({ transferId = "transfer-1", content = "payload" } = {}) {
  return {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId,
    messageId: "message-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    payload: { mode: "direct", content },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {},
  };
}

test("Session Record projection preserves explicit canonical facts", () => {
  const envelope = transferEnvelope();
  const projected = projectSessionRecordToContextMessage({
    messageUid: " message-1 ",
    role: "ASSISTANT",
    content: "result",
    transferEnvelopes: [envelope],
  });

  assert.equal(projected.messageUid, "message-1");
  assert.equal(projected.role, "assistant");
  assert.deepEqual(projected.transferEnvelopes, [envelope]);
});

test("Session Record projection never infers identity or role", () => {
  assert.throws(
    () => projectSessionRecordToContextMessage({ role: "user", content: "missing identity" }),
    /requires messageUid/,
  );
  assert.throws(
    () =>
      projectSessionRecordToContextMessage({ messageUid: "message-1", content: "missing role" }),
    /requires role/,
  );
  assert.throws(
    () =>
      projectSessionRecordToContextMessage({
        messageUid: "message-1",
        role: "human",
        content: "non-canonical role",
      }),
    /rejects role: human/,
  );
});

test("Session Record projection rejects malformed collections and transfer facts", () => {
  assert.throws(() => projectSessionRecordsToContextMessages({}), /requires a record array/);
  assert.throws(
    () =>
      projectSessionRecordToContextMessage({
        messageUid: "message-1",
        role: "assistant",
        attachments: {},
      }),
    /attachments to be an array/,
  );
  assert.throws(() => normalizeContextTransferEnvelopes([{}]), /invalid_transfer_envelope/);
  assert.deepEqual(
    normalizeContextTransferEnvelopes([transferEnvelope(), transferEnvelope()]),
    [transferEnvelope()],
  );
  assert.throws(
    () =>
      normalizeContextTransferEnvelopes([
        transferEnvelope(),
        transferEnvelope({ content: "conflicting payload" }),
      ]),
    /transfer_identity_conflict/,
  );
});
