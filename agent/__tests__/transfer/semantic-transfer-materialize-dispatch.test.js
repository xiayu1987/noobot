/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTransferProtocolOnly,
  identity,
  materializeOutputResult,
  persistTransferFile,
} from "./helpers/semantic-transfer-helper.js";
import { createTestAttachmentService } from "../helpers/test-runtime-context.js";

test("materializeOutputResult creates direct V2 envelope below the threshold", async () => {
  const result = await materializeOutputResult({
    content: "abcdef",
    policy: { preference: "auto", maxDirectChars: 10 },
    identity: identity(),
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "direct");
  assert.equal(result.envelope.payload.mode, "direct");
  assert.equal(result.envelope.payload.content, "abcdef");
});

test("materializeOutputResult does not silently fall back when attachment persistence is unavailable", async () => {
  await assert.rejects(
    () =>
      materializeOutputResult({
        content: "abcdef",
        policy: { preference: "attachment", allowAttachment: false },
        identity: identity(),
        runtime: { systemRuntime: { userId: "u1" } },
      }),
    /attachment_persistence_required/,
  );
});

test("persistTransferFile returns V2 transfer envelopes and path-free descriptors", async () => {
  const result = await persistTransferFile({
    runtime: {
      systemRuntime: { userId: "u1" },
      attachmentService: createTestAttachmentService({
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
      }),
    },
    sessionId: "session-test-1",
    name: "a.bin",
    mimeType: "application/octet-stream",
    contentBase64: "AQID",
    identity: identity(),
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  assert.deepEqual(Object.keys(result).sort(), ["attachments", "transferEnvelopes"]);
  assertTransferProtocolOnly(assert, { transferEnvelopes: result.transferEnvelopes });
  const envelope = result.transferEnvelopes[0];
  assert.equal(envelope.payload.mode, "attachment");
  assert.equal(envelope.payload.attachments[0].identity.attachmentId, "att-bin-1");
  assert.equal("path" in envelope, false);
  assert.equal("filePath" in envelope, false);
  assert.equal("attachmentMeta" in envelope, false);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].identity.attachmentId, "att-bin-1");
  assert.equal("origin" in result.attachments[0], false);
  assert.equal("path" in result.attachments[0], false);
});
