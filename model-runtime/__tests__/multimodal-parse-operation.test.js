/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { executeOpenAiOperation } from "../src/adapters/openai-capability-adapter.js";
import { executeNativeGeneration } from "../src/adapters/native-generation.js";
import {
  MODEL_ERROR_CODE,
  MODEL_GENERATION_API_TYPE,
  MODEL_OPERATION_KIND,
  ModelProtocolError,
} from "@noobot/model-protocol";

function completedResponse(text) {
  return {
    asResponse: async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text, annotations: [] }],
          },
        ],
      }),
  };
}

test("Web Search forces the search tool and returns text with url_citation sources", async () => {
  let request;
  const result = await executeOpenAiOperation({
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.5", base_url: "https://example.test/v1" },
    credential: "key",
    streaming: false,
    operation: {
      kind: MODEL_OPERATION_KIND.WEB_SEARCH,
      input: { query: "latest" },
      options: {},
    },
    openAiClientFactory: () => ({
      responses: {
        create: (body) => {
          request = body;
          return {
            asResponse: async () =>
              Response.json({
                status: "completed",
                output: [
                  { type: "web_search_call", status: "completed" },
                  {
                    type: "message",
                    content: [
                      {
                        type: "output_text",
                        text: "search result",
                        annotations: [
                          { type: "url_citation", title: "A", url: "https://example.test/a" },
                          { type: "url_citation", title: "A again", url: "https://example.test/a" },
                        ],
                      },
                    ],
                  },
                ],
              }),
          };
        },
      },
    }),
  });

  assert.equal(request.input[0].content[0].text, "latest");
  assert.match(request.instructions, /Search the web before answering/);
  assert.equal(request.tool_choice, "required");
  assert.deepEqual(result, {
    rawText: "search result",
    sources: [{ title: "A", url: "https://example.test/a" }],
  });
});

test("multimodal parse maps multiple image and document attachments to one Responses API input", async () => {
  let request;
  const result = await executeOpenAiOperation({
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.4", base_url: "https://example.test/v1" },
    credential: "key",
    streaming: false,
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
        create: (value) => {
          request = value;
          return completedResponse("parsed image");
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
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    streaming: false,
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
        create: (value) => {
          request = value;
          return completedResponse("parsed pdf");
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
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    streaming: false,
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
        create: (value) => {
          request = value;
          return completedResponse("ok");
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
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.4" },
    credential: "key",
    streaming: false,
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
        create: (value) => {
          request = value;
          return completedResponse("ok");
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

test("capability operations reject a streamed answer as a response mode mismatch", async () => {
  const calls = [];
  const sse = () =>
    new Response('data: {"id":"resp_sse"}\n\n', {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const operations = [
    {
      modelSpec: { model: "gpt-5.5", base_url: "https://example.test/v1" },
      operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "q" }, options: {} },
    },
    {
      modelSpec: {
        model: "img",
        base_url: "https://example.test/v1",
        multimodal_generation: {
          support_generation: { api_type: MODEL_GENERATION_API_TYPE.OPENAI_IMAGES },
        },
      },
      operation: {
        kind: MODEL_OPERATION_KIND.MEDIA_GENERATION,
        input: { prompt: "p", outputType: "image" },
        options: { imageUrls: [], n: 1 },
      },
    },
  ];
  for (const input of operations) {
    const execute =
      input.operation.kind === MODEL_OPERATION_KIND.MEDIA_GENERATION
        ? executeNativeGeneration
        : executeOpenAiOperation;
    await assert.rejects(
      execute({
        ...input,
        signal: new AbortController().signal,
        credential: "key",
        streaming: false,
        fetch: async (url) => {
          calls.push(url);
          return sse();
        },
      }),
      (error) => {
        assert.equal(error instanceof ModelProtocolError, true);
        assert.equal(error.code, MODEL_ERROR_CODE.RESPONSE_MODE_MISMATCH);
        return true;
      },
    );
  }
  assert.deepEqual(calls.map(String), [
    "https://example.test/v1/responses",
    "https://example.test/v1/images/generations",
  ]);
});

async function* responsesEvents(events) {
  yield* events;
}

function webSearchWithStream(events) {
  return executeOpenAiOperation({
    fetch: globalThis.fetch,
    modelSpec: { model: "gpt-5.5", base_url: "https://example.test/v1" },
    credential: "key",
    streaming: true,
    operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "q" }, options: {} },
    openAiClientFactory: () => ({
      responses: {
        create: async (body) => {
          assert.equal(body.stream, true);
          return responsesEvents(events);
        },
      },
    }),
  });
}

test("streamed capability operations accept only response.completed", async () => {
  const result = await webSearchWithStream([
    { type: "response.output_text.delta", delta: "partial" },
    {
      type: "response.completed",
      response: { status: "completed", output_text: "done", output: [] },
    },
  ]);
  assert.equal(result.rawText, "done");
  for (const events of [
    [
      {
        type: "response.incomplete",
        response: {
          id: "r1",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
      },
    ],
    [{ type: "response.output_text.delta", delta: "partial" }],
  ]) {
    await assert.rejects(webSearchWithStream(events), ModelProtocolError);
  }
});

test("capability operations reject a non-boolean streaming mode before any request", async () => {
  let created = false;
  await assert.rejects(
    executeOpenAiOperation({
      modelSpec: { model: "gpt-5.5" },
      credential: "key",
      operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "q" }, options: {} },
      openAiClientFactory: () => {
        created = true;
        return {};
      },
    }),
    /requestedStreaming must be boolean/,
  );
  assert.equal(created, false);
});
