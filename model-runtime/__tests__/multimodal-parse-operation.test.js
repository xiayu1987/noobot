/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeOpenAiOperation } from "../src/adapters/openai-capability-adapter.js";
import { dashscopeAdapter } from "../src/adapters/dashscope-adapter.js";
import { MODEL_OPERATION_KIND } from "@noobot/model-protocol";

test("multimodal parse maps multiple image and document attachments to one Responses API input", async () => {
  let request;
  const result = await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4", base_url: "https://example.test/v1" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "describe",
        attachments: [{
          mimeType: "image/png",
          data: "data:image/png;base64,AA==",
          fileName: "a.png",
        }, {
          mimeType: "application/pdf",
          data: "data:application/pdf;base64,AQ==",
          fileName: "b.pdf",
        }],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: async (value) => {
          request = value;
          return { output_text: "parsed image", output: [] };
        },
      },
    }),
  });
  assert.deepEqual(request.input[0].content, [
    { type: "input_text", text: "describe" },
    { type: "input_image", image_url: "data:image/png;base64,AA==" },
    {
      type: "input_file",
      file_data: "data:application/pdf;base64,AQ==",
      filename: "b.pdf",
    },
  ]);
  assert.equal(result.rawText, "parsed image");
});

test("multimodal parse maps documents to Responses API input_file", async () => {
  let request;
  await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "extract",
        attachments: [{
          mimeType: "application/pdf",
          data: "data:application/pdf;base64,AA==",
          fileName: "a.pdf",
        }],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: async (value) => {
          request = value;
          return { output_text: "parsed pdf", output: [] };
        },
      },
    }),
  });
  assert.deepEqual(request.input[0].content[1], {
    type: "input_file",
    file_data: "data:application/pdf;base64,AA==",
    filename: "a.pdf",
  });
});

test("dashscope adapter exposes multimodal parse through its canonical operation port", async () => {
  let request;
  await dashscopeAdapter.executeOperation({
    modelSpec: {
      model: "qwen3.5-plus",
      format: "dashscope",
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "extract",
        attachments: [{
          mimeType: "application/pdf",
          data: "data:application/pdf;base64,AA==",
          fileName: "a.pdf",
        }],
      },
      options: {},
    },
    openAiClientFactory: () => ({ responses: { create: async (value) => {
      request = value;
      return { output_text: "parsed", output: [] };
    } } }),
  });
  assert.equal(request.model, "qwen3.5-plus");
  assert.equal(request.input[0].content[1].type, "input_file");
});
