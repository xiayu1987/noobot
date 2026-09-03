/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentTransfer,
  assertTransferEnvelope,
  directTransfer,
  getTransferAttachments,
  getTransferEnvelopes,
  identity,
  transferSemanticContent,
} from "./helpers/semantic-transfer-helper.js";

test("V2 envelopes use one payload model and reject path-shaped fields", () => {
  const direct = directTransfer({
    transferId: identity().transferId,
    messageId: identity().messageId,
    identity: identity(),
    direction: "input",
    content: "hello",
    intent: { source: "user", reason: "input", scenario: "tool", strategy: "tool_input" },
  });
  assert.equal(direct.payload.mode, "direct");
  assert.equal(direct.payload.content, "hello");
  assert.equal(assertTransferEnvelope(direct), direct);

  const attachmentIdentity = identity({ transferId: "t-attachment", messageId: "m-attachment" });
  const attachment = attachmentTransfer({
    transferId: attachmentIdentity.transferId,
    messageId: attachmentIdentity.messageId,
    identity: attachmentIdentity,
    direction: "output",
    attachments: [
      {
        identity: { attachmentId: "att-1", sessionId: "session-test-1", attachmentSource: "model" },
        role: "primary",
        name: "result.md",
        mimeType: "text/markdown",
        size: 12,
        preview: "preview",
      },
    ],
    intent: { source: "tool", reason: "result", scenario: "tool", strategy: "tool_output" },
  });
  assert.deepEqual(attachment.payload.attachments[0].identity, {
    attachmentId: "att-1",
    sessionId: "session-test-1",
    attachmentSource: "model",
  });
  assert.throws(
    () => assertTransferEnvelope({ ...attachment, path: "/forbidden" }),
    /forbidden_path_field/,
  );
});

test("semantic transfer emits validated V2 envelopes for direct tool output", async () => {
  const result = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_output",
    text: "validation",
    identity: identity(),
    inlineMaxChars: 1024,
  });
  assert.deepEqual(Object.keys(result), ["transferEnvelopes"]);
  assert.equal(getTransferEnvelopes(result).length, 1);
  assert.equal(result.transferEnvelopes[0].payload.mode, "direct");
  assert.equal(result.transferEnvelopes[0].payload.content, "validation");
  assert.equal(getTransferAttachments(result).length, 0);
});
