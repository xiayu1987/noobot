/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toConversationMessages } from "../../src/context/session/message-converter.js";

test("toConversationMessages keeps transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 2,
    transferId: "transfer-1",
    messageId: "message-1",
    identity: { sessionId: "s1", turnScopeId: "t1", runId: "r1", producer: { type: "model", id: "model-1" } },
    direction: "output",
    payload: { mode: "attachment", attachments: [{ identity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" }, role: "primary", name: "a.md", mimeType: "text/markdown" }] },
    intent: { source: "model", reason: "result", scenario: "model", strategy: "model_output" },
    meta: {},
  };
  const messages = toConversationMessages([
    {
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
      role: "assistant",
      content: "ok",
      attachments: [],
      transferEnvelopes: [],
    },
  ]);

  assert.equal("attachments" in message, false);
  assert.equal("transferEnvelopes" in message, false);
});
