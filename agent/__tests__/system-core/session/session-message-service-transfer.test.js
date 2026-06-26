import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

test("SessionMessageService.appendTurn persists transferEnvelopes", async () => {
  const saved = [];
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
    async findById() {
      return {
        sessionId: "s1",
        parentSessionId: "",
        messages: [],
      };
    },
    async save(_userId, session) {
      saved.push(session);
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [
      {
        filePath: "/workspace/a.md",
        attachmentMeta: {
          attachmentId: "att_1",
          name: "a.md",
          owner: { type: "plugin", id: "harness-plugin" },
        },
      },
    ],
  };
  await service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "done",
    attachmentMetas: [{ attachmentId: "att_1", name: "a.md" }],
    transferEnvelopes: [envelope],
  });

  assert.equal(saved.length, 1);
  const lastMessage = saved[0]?.messages?.[0];
  assert.equal("attachmentMetas" in lastMessage, false);
  assert.equal("transferEnvelopes" in lastMessage, true);
  assert.deepEqual(lastMessage?.transferEnvelopes, [
    {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [
        {
          attachmentId: "att_1",
          name: "a.md",
          path: "/workspace/a.md",
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    },
  ]);
  assert.equal("attachmentMeta" in lastMessage.transferEnvelopes[0], false);
  assert.equal("attachmentMeta" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("id" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("type" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("source" in lastMessage.transferEnvelopes[0].files[0], false);
});
