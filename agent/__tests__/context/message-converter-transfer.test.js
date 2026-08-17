/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { projectSessionRecordsToContextMessages as toConversationMessages } from "@noobot/context-protocol/message/session-projection";

test("toConversationMessages keeps transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer-1",
    messageId: "message-1",
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
  assert.equal("transferEnvelopes" in messages[0], true);
  assert.deepEqual(messages[0].transferEnvelopes, [envelope]);
  assert.equal("attachments" in messages[0], false);
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

  assert.equal("attachments" in message, false);
  assert.equal("transferEnvelopes" in message, false);
});
