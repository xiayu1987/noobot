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
  getTransferAttachments,
  identity,
  persistTransferArtifacts,
} from "./helpers/semantic-transfer-helper.js";
import { createTestAttachmentService } from "../helpers/test-runtime-context.js";

test("persistTransferArtifacts maps storage records to canonical attachment references", async () => {
  const result = await persistTransferArtifacts({
    runtime: {
      systemRuntime: { userId: "u1" },
      attachmentService: createTestAttachmentService({
        async ingestGeneratedArtifacts({ artifacts, sessionId, attachmentSource }) {
          return artifacts.map((artifact, index) => ({
            attachmentId: `att-${index + 1}`,
            sessionId,
            attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: 3,
            path: "/host/must-not-cross-protocol",
            relativePath: "attachments/must-not-cross-protocol",
          }));
        },
      }),
    },
    sessionId: "session-test-1",
    attachmentSource: "model",
    identity: identity(),
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YWJj" }],
  });
  assert.deepEqual(Object.keys(result).sort(), ["attachments", "transferEnvelopes"]);
  assertTransferProtocolOnly(assert, { transferEnvelopes: result.transferEnvelopes });
  const [descriptor] = result.attachments;
  assert.equal(descriptor.identity.attachmentId, "att-1");
  assert.equal("path" in descriptor, false);
  assert.equal("relativePath" in descriptor, false);
  assert.equal("origin" in descriptor, false);
  const attachment = getTransferAttachments(result)[0];
  assert.equal(attachment.identity.attachmentId, "att-1");
  assert.equal(attachment.identity.sessionId, "session-test-1");
  assert.equal("path" in attachment, false);
  assert.equal("filePath" in attachment, false);
  assert.equal("relativePath" in attachment, false);
});

test("persistence requires an attachment service instead of returning a direct fallback", async () => {
  await assert.rejects(
    () =>
      persistTransferArtifacts({
        runtime: { systemRuntime: { userId: "u1" } },
        sessionId: "session-test-1",
        identity: identity(),
        intent: {
          source: "tool",
          reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
          scenario: "tool",
          strategy: "tool_output",
        },
        artifacts: [{ name: "a.txt", contentBase64: "YQ==" }],
      }),
    /semantic_transfer_attachment_service_required/,
  );
});

test("persistence rejects any attachment cardinality drift", async () => {
  await assert.rejects(
    () =>
      persistTransferArtifacts({
        runtime: {
          systemRuntime: { userId: "u1" },
          attachmentService: createTestAttachmentService({
            async ingestGeneratedArtifacts() {
              return [
                {
                  attachmentId: "att-only-one",
                  sessionId: "session-test-1",
                  attachmentSource: "model",
                  name: "a.txt",
                  mimeType: "text/plain",
                  size: 1,
                },
              ];
            },
          }),
        },
        identity: identity(),
        artifacts: [
          { name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" },
          { name: "empty.bin", mimeType: "application/octet-stream", contentBase64: "" },
        ],
      }),
    /semantic_transfer_attachment_cardinality_mismatch:2:1/,
  );
});

test("persistTransferArtifacts projects stored origin into descriptors but never into envelopes", async () => {
  const result = await persistTransferArtifacts({
    runtime: {
      systemRuntime: { userId: "u1" },
      attachmentService: createTestAttachmentService({
        async ingestGeneratedArtifacts({ artifacts, sessionId, attachmentSource }) {
          return artifacts.map((artifact, index) => ({
            attachmentId: `att-src-${index + 1}`,
            sessionId,
            attachmentSource,
            name: artifact.name,
            mimeType: artifact.mimeType,
            size: 3,
            origin: { view: "host", path: "D:/work/report.xlsx" },
            path: "/host/must-not-cross-protocol",
          }));
        },
      }),
    },
    identity: identity(),
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
    artifacts: [
      {
        name: "report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        contentBase64: "YWJj",
        origin: { view: "host", path: "D:/work/report.xlsx" },
      },
    ],
  });
  const [descriptor] = result.attachments;
  assert.deepEqual(descriptor.origin, { view: "host", path: "D:/work/report.xlsx" });
  assert.equal("path" in descriptor, false);
  const [reference] = getTransferAttachments(result);
  assert.equal("origin" in reference, false);
});

test("persistTransferArtifacts rejects stored records without a name instead of inventing one", async () => {
  await assert.rejects(
    () =>
      persistTransferArtifacts({
        runtime: {
          systemRuntime: { userId: "u1" },
          attachmentService: createTestAttachmentService({
            async ingestGeneratedArtifacts({ sessionId, attachmentSource }) {
              return [
                { attachmentId: "att-x", sessionId, attachmentSource, mimeType: "text/plain" },
              ];
            },
          }),
        },
        identity: identity(),
        artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YQ==" }],
      }),
    /invalid_attachment_name/,
  );
});
