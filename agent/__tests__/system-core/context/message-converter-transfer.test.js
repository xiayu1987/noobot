/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { toConversationMessages } from "../../../src/system-core/context/session/message-converter.js";

test("toConversationMessages keeps transferEnvelopes", () => {
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/a.md",
  };
  const messages = toConversationMessages([
    {
      role: "assistant",
      content: "ok",
      attachments: [{ attachmentId: "att_1" }],
      transferEnvelopes: [envelope],
    },
  ]);

  assert.equal(messages.length, 1);
  assert.equal("transferEnvelopes" in messages[0], true);
  assert.deepEqual(messages[0].transferEnvelopes, [envelope]);
  assert.deepEqual(messages[0].attachments, [{ attachmentId: "att_1" }]);
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
