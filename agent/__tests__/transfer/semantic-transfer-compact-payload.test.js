/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";
import {
  compactToolResultTextForModel,
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
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  const compacted = JSON.parse(
    compactToolResultTextForModel(
      JSON.stringify({ toolName: "tool", ok: true, transferEnvelopes: [envelope] }),
    ),
  );
  assert.deepEqual(Object.keys(compacted), ["toolName", "ok", "transferEnvelopes"]);
  assert.throws(
    () => compactToolResultTextForModel(JSON.stringify({ toolName: "tool" })),
    /tool_result_ok_not_boolean/,
  );
  assert.deepEqual(
    compacted.transferEnvelopes[0].payload.attachments[0].identity,
    attachment("att-1").identity,
  );
  assert.deepEqual(Object.keys(compacted.transferEnvelopes[0].payload.attachments[0]).sort(), [
    "identity",
    "mimeType",
    "name",
    "preview",
    "role",
    "size",
  ]);
});

test("consumer returns only validated V2 envelopes and canonical attachment references", () => {
  const envelopes = [
    attachmentTransfer({
      ...identity({ transferId: "t-1", presentationMessageId: "m-1" }),
      identity: identity({ transferId: "t-1", presentationMessageId: "m-1" }),
      direction: "output",
      attachments: [attachment("att-1")],
      intent: {
        source: "tool",
        reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
        scenario: "tool",
        strategy: "tool_output",
      },
    }),
    attachmentTransfer({
      ...identity({ transferId: "t-2", presentationMessageId: "m-2" }),
      identity: identity({ transferId: "t-2", presentationMessageId: "m-2" }),
      direction: "output",
      attachments: [attachment("att-2")],
      intent: {
        source: "tool",
        reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
        scenario: "tool",
        strategy: "tool_output",
      },
    }),
  ];
  assert.equal(getTransferEnvelopes({ transferEnvelopes: envelopes }).length, 2);
  assert.deepEqual(
    getTransferAttachments(envelopes).map((item) => item.identity.attachmentId),
    ["att-1", "att-2"],
  );
  assert.throws(
    () => getTransferAttachments({ attachmentMetas: [{ attachmentId: "legacy" }] }),
    /invalid_transfer_envelope:unknown_envelope_field:attachmentMetas/,
  );
});
