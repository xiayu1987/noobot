import test from "node:test";
import assert from "node:assert/strict";

import { toConversationMessages } from "../../../src/system-core/context/session/message-converter.js";

test("toConversationMessages keeps transferEnvelope/transferEnvelopes for replay and workflow payload", () => {
  const transferEnvelope = {
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
      attachmentMetas: [{ attachmentId: "att_1" }],
      transferEnvelope,
      transferEnvelopes: [transferEnvelope],
    },
  ]);

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].transferEnvelope, transferEnvelope);
  assert.deepEqual(messages[0].transferEnvelopes, [transferEnvelope]);
  assert.deepEqual(messages[0].attachmentMetas, [{ attachmentId: "att_1" }]);
});

