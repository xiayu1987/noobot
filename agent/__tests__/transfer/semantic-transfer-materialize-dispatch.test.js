/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTransferProtocolOnly,
  identity,
  materializeOutputResult,
  persistTransferFile,
} from "./helpers/semantic-transfer-helper.js";

test("materializeOutputResult creates direct V2 envelope below the threshold", async () => {
  const result = await materializeOutputResult({
    content: "abcdef",
    policy: { prefer: "auto", maxDirectChars: 10 },
    identity: identity(),
    intent: { source: "tool", reason: "test", scenario: "tool", strategy: "tool_output" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "direct");
  assert.equal(result.envelope.payload.mode, "direct");
  assert.equal(result.envelope.payload.content, "abcdef");
});

test("materializeOutputResult does not silently fall back when attachment persistence is unavailable", async () => {
  await assert.rejects(
    () => materializeOutputResult({
      content: "abcdef",
      policy: { prefer: "attachment", allowAttachmentPersist: false },
      identity: identity(),
      runtime: { userId: "u1" },
    }),
    /semantic_transfer_attachment_service_required/,
  );
});

test("persistTransferFile returns only V2 transfer envelopes", async () => {
  const result = await persistTransferFile({
    attachmentService: {
      async ingestGeneratedArtifacts({ artifacts, sessionId, attachmentSource }) {
        return artifacts.map((artifact) => ({
          attachmentId: "att-bin-1",
          sessionId,
          attachmentSource,
          name: artifact.name,
          mimeType: artifact.mimeType,
          size: 3,
        }));
      },
    },
    userId: "u1",
    sessionId: "session-test-1",
    name: "a.bin",
    mimeType: "application/octet-stream",
    contentBase64: "AQID",
    identity: identity(),
    intent: { source: "tool", reason: "test", scenario: "tool", strategy: "tool_output" },
  });
  assertTransferProtocolOnly(assert, result);
  const envelope = result.transferEnvelopes[0];
  assert.equal(envelope.payload.mode, "attachment");
  assert.equal(envelope.payload.attachments[0].identity.attachmentId, "att-bin-1");
  assert.equal("path" in envelope, false);
  assert.equal("filePath" in envelope, false);
  assert.equal("attachmentMeta" in envelope, false);
});
