import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAttachmentMetasFromToolResult,
  fetchRemoteMediaArtifact,
} from "../../../../src/system-core/agent/core/media/artifact-service.js";

test("extractAttachmentMetasFromToolResult preserves relativePath/path", () => {
  const toolResultText = JSON.stringify({
    toolName: "multimodal_generate",
    ok: true,
    attachmentMetas: [
      {
        attachmentId: "att_1",
        sessionId: "s1",
        attachmentSource: "model",
        name: "generated_image_1.png",
        mimeType: "image/png",
        size: 123,
        path: "/tmp/a.png",
        relativePath: "runtime/attach/scoped/s1/model/a.png",
        generatedByModel: true,
        generationSource: "multimodal_generate_tool",
      },
    ],
  });

  const metas = extractAttachmentMetasFromToolResult(
    "multimodal_generate",
    toolResultText,
  );
  assert.equal(metas.length, 1);
  assert.equal(metas[0]?.path, "/tmp/a.png");
  assert.equal(
    metas[0]?.relativePath,
    "runtime/attach/scoped/s1/model/a.png",
  );
});

test("fetchRemoteMediaArtifact returns null when remote response is not ok", async () => {
  const artifact = await fetchRemoteMediaArtifact(
    "https://example.com/a.png",
    async () => ({
      ok: false,
      status: 404,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
    1,
    {},
  );
  assert.equal(artifact, null);
});

test("fetchRemoteMediaArtifact returns null when fetch throws", async () => {
  const artifact = await fetchRemoteMediaArtifact(
    "https://example.com/a.png",
    async () => {
      throw new Error("network failed");
    },
    2,
    {},
  );
  assert.equal(artifact, null);
});
