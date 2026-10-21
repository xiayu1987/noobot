/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";

import { projectSessionRecordsToContextMessages as toConversationMessages } from "@noobot/context-protocol/message/session-projection";
import { readContextMessageValue } from "@noobot/context-protocol/message/codec";

test("toConversationMessages keeps transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer-1",
    presentationMessageId: "message-1",
    identity: {
      sessionId: "s1",
      turnScopeId: "t1",
      runId: "r1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: "a.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "tool",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: {},
  };
  const messages = toConversationMessages([
    {
      messageUid: "message-1",
      role: "assistant",
      content: "ok",
      transferEnvelopes: [envelope],
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal("transferEnvelopes" in messages[0], false);
  assert.deepEqual(readContextMessageValue(messages[0], "transferEnvelopes"), [envelope]);
  assert.equal(readContextMessageValue(messages[0], "attachments"), undefined);
});

test("toConversationMessages omits empty legacy attachment/transfer mirrors", () => {
  const [message] = toConversationMessages([
    {
      messageUid: "message-1",
      role: "assistant",
      content: "ok",
      attachments: [],
      transferEnvelopes: [],
    },
  ]);

  assert.equal(readContextMessageValue(message, "attachments"), undefined);
  assert.equal(readContextMessageValue(message, "transferEnvelopes"), undefined);
});
