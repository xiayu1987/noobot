/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTransferProtocolOnly,
  getTransferAttachments,
  identity,
  persistTransferArtifacts,
} from "./helpers/semantic-transfer-helper.js";

test("persistTransferArtifacts maps storage records to canonical attachment references", async () => {
  const result = await persistTransferArtifacts({
    attachmentService: {
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
    },
    userId: "u1",
    sessionId: "session-test-1",
    attachmentSource: "model",
    identity: identity(),
    artifacts: [{ name: "a.txt", mimeType: "text/plain", contentBase64: "YWJj" }],
  });
  assertTransferProtocolOnly(assert, result);
  const attachment = getTransferAttachments(result)[0];
  assert.equal(attachment.identity.attachmentId, "att-1");
  assert.equal(attachment.identity.sessionId, "session-test-1");
  assert.equal("path" in attachment, false);
  assert.equal("filePath" in attachment, false);
  assert.equal("relativePath" in attachment, false);
});

test("persistence requires an attachment service instead of returning a direct fallback", async () => {
  await assert.rejects(
    () => persistTransferArtifacts({ userId: "u1", sessionId: "session-test-1", identity: identity(), artifacts: [{ name: "a.txt", contentBase64: "YQ==" }] }),
    /semantic_transfer_attachment_service_required/,
  );
});
