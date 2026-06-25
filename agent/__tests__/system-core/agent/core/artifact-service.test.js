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

test("extractAttachmentMetasFromToolResult ignores non-runtime-attach transfer files", () => {
  const toolResultText = JSON.stringify({
    toolName: "overflow_tool",
    ok: true,
    transferEnvelopes: [
      {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        filePath: "/workspace/overflow.json",
        attachmentMeta: {
          name: "overflow.json",
          mimeType: "application/json",
          path: "/host/overflow.json",
          relativePath: "runtime/overflow.json",
        },
        files: [
          {
            filePath: "/workspace/overflow.json",
            attachmentMeta: {
              name: "overflow.json",
              mimeType: "application/json",
              path: "/host/overflow.json",
              relativePath: "runtime/overflow.json",
            },
          },
        ],
      },
    ],
  });

  const metas = extractAttachmentMetasFromToolResult("overflow_tool", toolResultText);
  assert.equal(metas.length, 0);
});

test("extractAttachmentMetasFromToolResult reads transferEnvelopes and deduplicates", () => {
  const toolResultText = JSON.stringify({
    toolName: "multimodal_generate",
    ok: true,
    attachmentMetas: [
      {
        attachmentId: "att_shared",
        name: "generated.png",
        mimeType: "image/png",
        path: "/host/generated.png",
        relativePath: "runtime/attach/scoped/s1/model/generated.png",
      },
    ],
    transferEnvelopes: [
      {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        files: [
          {
            filePath: "/workspace/generated.png",
            attachmentMeta: {
              attachmentId: "att_shared",
              name: "generated.png",
              mimeType: "image/png",
              path: "/host/generated.png",
              relativePath: "runtime/attach/scoped/s1/model/generated.png",
            },
          },
          {
            filePath: "/workspace/extra.png",
            attachmentMeta: {
              attachmentId: "att_extra",
              name: "extra.png",
              mimeType: "image/png",
              path: "/host/extra.png",
              relativePath: "runtime/attach/scoped/s1/model/extra.png",
            },
          },
        ],
      },
    ],
  });

  const metas = extractAttachmentMetasFromToolResult("multimodal_generate", toolResultText);
  assert.equal(metas.length, 2);
  assert.deepEqual(
    metas.map((item) => item.attachmentId).sort(),
    ["att_extra", "att_shared"],
  );
});

test("extractAttachmentMetasFromToolResult supports transferEnvelopes-only payload", () => {
  const toolResultText = JSON.stringify({
    toolName: "plugin_tool",
    ok: true,
    transferEnvelopes: [
      {
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        files: [
          {
            filePath: "/workspace/r1.txt",
            attachmentMeta: {
              attachmentId: "att_r1",
              name: "r1.txt",
              mimeType: "text/plain",
              path: "/host/r1.txt",
              relativePath: "runtime/attach/scoped/s1/model/r1.txt",
            },
          },
        ],
      },
    ],
  });
  const metas = extractAttachmentMetasFromToolResult("plugin_tool", toolResultText);
  assert.equal(metas.length, 1);
  assert.equal(metas[0].attachmentId, "att_r1");
});

test("extractAttachmentMetasFromToolResult returns empty for invalid json fallback path", () => {
  const metas = extractAttachmentMetasFromToolResult("broken_tool", "{not_json");
  assert.deepEqual(metas, []);
});
