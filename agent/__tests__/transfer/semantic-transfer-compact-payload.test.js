/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPACT_TRANSFER_FILE_FIELDS,
  COMPACT_TRANSFER_PAYLOAD_FIELDS,
  compactToolResultTextForModel,
  createTransferEnvelope,
  directTransfer,
  getTransferAttachments,
  getTransferEnvelopes,
  identity,
  attachmentTransfer,
} from "./helpers/semantic-transfer-helper.js";

function attachment(id, name = `${id}.txt`) {
  return {
    identity: {
      attachmentId: id,
      sessionId: "session-test-1",
      attachmentSource: "model",
    },
    name,
    mimeType: "text/plain",
    size: 3,
    preview: "generated preview",
  };
}

test("compact model view retains only V2 transfer envelopes and canonical attachment identities", () => {
  const envelope = attachmentTransfer({
    ...identity(),
    identity: identity(),
    direction: "output",
    attachments: [attachment("att-1", "generated.txt")],
    intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_output" },
  });
  const compacted = JSON.parse(compactToolResultTextForModel(JSON.stringify({ toolName: "tool", transferEnvelopes: [envelope] })));
  assert.deepEqual(COMPACT_TRANSFER_PAYLOAD_FIELDS, ["transferEnvelopes"]);
  assert.deepEqual(Object.keys(compacted), ["toolName", "transferEnvelopes"]);
  assert.deepEqual(compacted.transferEnvelopes[0].payload.attachments[0].identity, attachment("att-1").identity);
  assert.deepEqual(Object.keys(compacted.transferEnvelopes[0].payload.attachments[0]).sort(), COMPACT_TRANSFER_FILE_FIELDS.slice().sort());
});

test("consumer returns only validated V2 envelopes and canonical attachment references", () => {
  const envelopes = [
    attachmentTransfer({ ...identity({ transferId: "t-1", messageId: "m-1" }), identity: identity({ transferId: "t-1", messageId: "m-1" }), direction: "output", attachments: [attachment("att-1")] , intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_output" } }),
    attachmentTransfer({ ...identity({ transferId: "t-2", messageId: "m-2" }), identity: identity({ transferId: "t-2", messageId: "m-2" }), direction: "output", attachments: [attachment("att-2")] , intent: { source: "tool", reason: "tool_result", scenario: "tool", strategy: "tool_output" } }),
  ];
  assert.equal(getTransferEnvelopes({ transferEnvelopes: envelopes }).length, 2);
  assert.deepEqual(getTransferAttachments(envelopes).map((item) => item.identity.attachmentId), ["att-1", "att-2"]);
  assert.throws(
    () => getTransferAttachments({ attachmentMetas: [{ attachmentId: "legacy" }] }),
    /invalid_transfer_envelope:unknown_envelope_field:attachmentMetas/,
  );
});
