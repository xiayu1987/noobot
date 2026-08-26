/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeOpenAiOperation } from "../src/adapters/openai-capability-adapter.js";
import { dashscopeAdapter } from "../src/adapters/dashscope-adapter.js";
import { IMAGE_GENERATION_API_TYPE, MODEL_OPERATION_KIND } from "@noobot/model-protocol";

test("Web Search reads text from the canonical Responses output items", async () => {
  const result = await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.5", base_url: "https://example.test/v1" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.WEB_SEARCH,
      input: { query: "latest" },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: async () => ({
          output: [
            { type: "web_search_call", status: "completed" },
            {
              type: "message",
              content: [{ type: "output_text", text: "search result" }],
            },
          ],
        }),
      },
    }),
  });

  assert.equal(result.rawText, "search result");
  assert.deepEqual(
    result.output.map((item) => item.type),
    ["web_search_call", "message"],
  );
});

test("Responses image generation sends the prompt through the canonical input field", async () => {
  let request;
  await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4", base_url: "https://example.test/v1" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.IMAGE_GENERATION,
      input: { prompt: "draw a small red square" },
      options: { apiType: IMAGE_GENERATION_API_TYPE.OPENAI_RESPONSES, size: "1024x1024" },
    },
    openAiClientFactory: () => ({
      responses: {
        create: async (value) => {
          request = value;
          return { output_text: "", output: [] };
        },
      },
    }),
  });

  assert.deepEqual(request, {
    model: "gpt-5.4",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: "draw a small red square" }],
      },
    ],
    tools: [{ type: "image_generation", size: "1024x1024" }],
    tool_choice: "required",
  });
});

test("multimodal parse maps multiple image and document attachments to one Responses API input", async () => {
  let request;
  const result = await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4", base_url: "https://example.test/v1" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "describe",
        attachments: [
          {
            mimeType: "image/png",
            data: "data:image/png;base64,AA==",
            fileName: "a.png",
          },
          {
            mimeType: "application/pdf",
            data: "data:application/pdf;base64,AQ==",
            fileName: "b.pdf",
          },
        ],
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
        attachments: [
          {
            mimeType: "application/pdf",
            data: "data:application/pdf;base64,AA==",
            fileName: "a.pdf",
          },
        ],
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

test("multimodal parse maps normalized audio to Responses API input_audio", async () => {
  let request;
  await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "transcribe",
        attachments: [
          { mimeType: "audio/wav", data: "data:audio/wav;base64,AQ==", fileName: "a.wav" },
        ],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: async (value) => {
          request = value;
          return { output_text: "ok" };
        },
      },
    }),
  });
  assert.deepEqual(request.input[0].content[1], {
    type: "input_audio",
    input_audio: { data: "AQ==", format: "wav" },
  });
});

test("multimodal parse maps video to an OpenAI Responses API file input", async () => {
  let request;
  await executeOpenAiOperation({
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "parse",
        attachments: [
          { mimeType: "video/mp4", data: "data:video/mp4;base64,AQ==", fileName: "a.mp4" },
        ],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: async (value) => {
          request = value;
          return { output_text: "ok" };
        },
      },
    }),
  });
  assert.deepEqual(request.input[0].content[1], {
    type: "input_file",
    file_data: "data:video/mp4;base64,AQ==",
    filename: "a.mp4",
  });
});

test("dashscope adapter parses images through Chat Completions", async () => {
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
        attachments: [
          { mimeType: "image/png", data: "data:image/png;base64,AA==", fileName: "a.png" },
        ],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      chat: {
        completions: {
          create: async (value) => {
            request = value;
            return { choices: [{ message: { content: "parsed" } }] };
          },
        },
      },
    }),
  });
  assert.equal(request.model, "qwen3.5-plus");
  assert.equal(request.messages[0].content[1].type, "image_url");
});

test("dashscope adapter maps audio and video with provider-native content blocks", async () => {
  let request;
  await dashscopeAdapter.executeOperation({
    modelSpec: { model: "qwen3.5-omni-plus", format: "dashscope" },
    credential: "key",
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "parse media",
        attachments: [
          { mimeType: "audio/wav", data: "data:audio/wav;base64,AQ==", fileName: "a.wav" },
          { mimeType: "video/mp4", data: "data:video/mp4;base64,Ag==", fileName: "b.mp4" },
        ],
      },
      options: {},
    },
    openAiClientFactory: () => ({
      chat: {
        completions: {
          create: async (value) => {
            request = value;
            return { choices: [{ message: { content: "parsed" } }] };
          },
        },
      },
    }),
  });
  assert.deepEqual(request.messages[0].content.slice(1), [
    { type: "audio_url", audio_url: { url: "data:audio/wav;base64,AQ==" } },
    { type: "video_url", video_url: { url: "data:video/mp4;base64,Ag==" } },
  ]);
});
