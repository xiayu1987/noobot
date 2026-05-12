import test from "node:test";
import assert from "node:assert/strict";

import { extractAttachmentMetasFromToolResult } from "../../../../system-core/agent/core/media/artifact-service.js";

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

