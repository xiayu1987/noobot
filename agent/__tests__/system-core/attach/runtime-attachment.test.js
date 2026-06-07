import test from "node:test";
import assert from "node:assert/strict";

import { appendAttachmentMetasToRuntimeAndTurn } from "../../../src/system-core/attach/runtime-attachment.js";
import { createCurrentTurnMessagesStore } from "../../../src/system-core/context/session/current-turn-store.js";

test("appendAttachmentMetasToRuntimeAndTurn appends metas only to last message in turn store", () => {
  const runtime = { attachmentMetas: [] };
  const turnStore = createCurrentTurnMessagesStore([
    { role: "assistant", type: "tool_call", dialogProcessId: "dp1" },
    { role: "tool", type: "tool_result", dialogProcessId: "dp1", attachmentMetas: [] },
  ]);

  appendAttachmentMetasToRuntimeAndTurn({
    runtime,
    turnMessageStore: turnStore,
    attachmentMetas: [
      {
        attachmentId: "att_1",
        sessionId: "s1",
        attachmentSource: "model",
        name: "img.png",
        mimeType: "image/png",
        size: 10,
        path: "/tmp/img.png",
      },
    ],
  });

  const runtimeMetas = Array.isArray(runtime.attachmentMetas)
    ? runtime.attachmentMetas
    : [];
  assert.equal(runtimeMetas.length, 1);
  const messages = turnStore.toArray();
  assert.equal(Array.isArray(messages[1]?.attachmentMetas), true);
  assert.equal(messages[1].attachmentMetas.length, 1);
  assert.equal(messages[1].attachmentMetas[0]?.attachmentId, "att_1");
  assert.equal("attachmentMetas" in messages[0], false);
});
