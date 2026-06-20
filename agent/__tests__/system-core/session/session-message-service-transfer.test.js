import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

test("SessionMessageService.appendTurn persists transferEnvelopes and merges legacy transferEnvelope", async () => {
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
  const transferEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "/workspace/a.md",
    files: [
      {
        filePath: "/workspace/a.md",
        attachmentMeta: {
          attachmentId: "att_1",
          name: "a.md",
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
    transferEnvelope,
    transferEnvelopes: [transferEnvelope],
  });

  assert.equal(saved.length, 1);
  const lastMessage = saved[0]?.messages?.[0];
  assert.equal(Array.isArray(lastMessage?.attachmentMetas), true);
  assert.equal(lastMessage?.attachmentMetas?.length, 1);
  assert.equal("transferEnvelope" in lastMessage, false);
  assert.deepEqual(lastMessage?.transferEnvelopes, [transferEnvelope]);
});

