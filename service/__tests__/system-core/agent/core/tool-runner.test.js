import test from "node:test";
import assert from "node:assert/strict";

import { executeToolCall } from "../../../../system-core/agent/core/execution/tool-runner.js";

test("executeToolCall extracts attachmentMetas from multimodal tool result", async () => {
  const call = {
    id: "call_1",
    name: "multimodal_generate",
    args: {},
  };
  const tool = {
    invoke: async () =>
      JSON.stringify({
        toolName: "multimodal_generate",
        ok: true,
        attachmentMetas: [
          {
            attachmentId: "att_1",
            name: "generated_image_1.png",
            mimeType: "image/png",
            size: 123,
            sessionId: "s1",
            attachmentSource: "model",
            path: "/tmp/a.png",
            relativePath: "runtime/attach/scoped/s1/model/a.png",
            generatedByModel: true,
            generationSource: "multimodal_generate_tool",
          },
        ],
      }),
  };

  const result = await executeToolCall({
    call,
    tool,
    turn: 1,
  });

  assert.equal(result.success, true);
  assert.equal(Array.isArray(result.extractedAttachmentMetas), true);
  assert.equal(result.extractedAttachmentMetas.length, 1);
  assert.equal(
    result.extractedAttachmentMetas[0]?.relativePath,
    "runtime/attach/scoped/s1/model/a.png",
  );
});

