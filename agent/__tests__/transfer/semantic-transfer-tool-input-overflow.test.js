/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_INPUT_OVERFLOW_CHARS,
  assertTransferProtocolOnly,
  firstTransferAttachment,
  identity,
  transferSemanticContent,
} from "./helpers/semantic-transfer-helper.js";

function runtime() {
  return {
    systemRuntime: { userId: "u1", sessionId: "session-test-1" },
    attachmentService: {
      async ingestGeneratedArtifacts({ artifacts, sessionId, attachmentSource }) {
        return artifacts.map((artifact, index) => ({
          attachmentId: `tool-input-${index + 1}`,
          sessionId,
          attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: Buffer.from(artifact.contentBase64, "base64").length,
        }));
      },
    },
  };
}

test("large tool input is represented by an input attachment envelope", async () => {
  const result = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    text: "x".repeat(64),
    inlineMaxChars: 10,
    identity: identity(),
    runtime: runtime(),
  });
  assertTransferProtocolOnly(assert, result);
  const envelope = result.transferEnvelopes[0];
  assert.equal(envelope.direction, "input");
  assert.equal(envelope.payload.mode, "attachment");
  assert.equal(firstTransferAttachment(result).identity.attachmentId, "tool-input-1");
});

test("write_file overflow preserves tool policy metadata without path fields in the envelope", async () => {
  const result = await transferSemanticContent({
    scenario: "tool",
    strategy: "tool_input",
    call: {
      name: "write_file",
      args: { filePath: "large.txt", content: "x".repeat(TOOL_INPUT_OVERFLOW_CHARS + 1) },
    },
    identity: identity(),
    runtime: runtime(),
  });
  const envelope = result.transferEnvelopes[0];
  assert.equal(envelope.payload.mode, "attachment");
  assert.equal(envelope.meta.attributes.exceeded, true);
  assert.equal("path" in envelope, false);
  assert.equal("filePath" in envelope, false);
});
