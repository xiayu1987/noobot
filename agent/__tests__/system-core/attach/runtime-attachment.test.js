import test from "node:test";
import assert from "node:assert/strict";

import { appendAttachmentMetasToRuntimeAndTurn } from "../../../src/system-core/attach/runtime-attachment.js";
import { createCurrentTurnMessagesStore } from "../../../src/system-core/context/session/current-turn-store.js";

test("appendAttachmentMetasToRuntimeAndTurn keeps ordinary attachments out of semantic-transfer envelopes", () => {
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
  assert.equal("transferEnvelopes" in messages[1], false);
  assert.equal("attachmentMetas" in messages[0], false);
});

test("appendAttachmentMetasToRuntimeAndTurn merges with existing transfer envelopes on last turn store message", () => {
  const runtime = { attachmentMetas: [] };
  const existingEnvelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    filePath: "existing.md",
    files: [
      {
        filePath: "existing.md",
        attachmentMeta: { attachmentId: "att_existing", path: "/tmp/existing.md" },
        role: "primary",
      },
    ],
  };
  const turnStore = createCurrentTurnMessagesStore([
    {
      role: "assistant",
      content: "done",
      transferEnvelopes: [existingEnvelope],
      attachmentMetas: [{ attachmentId: "legacy_should_be_removed" }],
    },
  ]);

  appendAttachmentMetasToRuntimeAndTurn({
    runtime,
    turnMessageStore: turnStore,
    attachmentMetas: [
      {
        attachmentId: "att_new",
        sessionId: "s1",
        attachmentSource: "model",
        name: "new.md",
        mimeType: "text/markdown",
        path: "/tmp/new.md",
        generationSource: "semantic_transfer_tool_output",
      },
    ],
  });

  const [message] = turnStore.toArray();
  assert.equal(message.attachmentMetas, undefined);
  assert.equal("transferEnvelopes" in message, true);
  assert.equal(message.transferEnvelopes.length, 2);
  assert.equal(message.transferEnvelopes[0]?.files?.[0]?.attachmentMeta?.attachmentId, "att_existing");
  assert.equal(message.transferEnvelopes[1]?.files?.[0]?.attachmentMeta?.attachmentId, "att_new");
  assert.equal(runtime.attachmentMetas.length, 1);
  assert.equal(runtime.attachmentMetas[0]?.attachmentId, "att_new");
});
