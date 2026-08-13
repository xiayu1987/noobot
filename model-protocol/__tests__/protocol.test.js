/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createModelRequest,
  createModelResponse,
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_OPERATION_KIND,
  MODEL_PROTOCOL_VERSION,
  validateModelResponse,
} from "../src/index.js";

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "agent.main",
  purpose: "main_agent",
  domain: "primary",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
};
const model = {
  model: "gpt-5",
  format: "openai_compatible",
  providerId: "openai",
  adapterId: "openai-compatible",
};

test("model request has one versioned canonical shape", () => {
  const request = createModelRequest({ invocation, model, messages: [] });
  assert.equal(request.protocolVersion, MODEL_PROTOCOL_VERSION);
  assert.equal(request.model.providerId, "openai");
  assert.equal(request.model.adapterId, "openai-compatible");
  assert.throws(() => {
    request.model = {};
  }, TypeError);
});

test("model operations are strict discriminated contracts", () => {
  const webSearch = createModelRequest({
    invocation,
    model,
    messages: [],
    operation: { kind: MODEL_OPERATION_KIND.WEB_SEARCH, input: { query: "latest news" } },
  });
  assert.deepEqual(webSearch.operation, {
    kind: MODEL_OPERATION_KIND.WEB_SEARCH,
    input: { query: "latest news" },
    options: {},
  });
  const multimodalParse = createModelRequest({
    invocation,
    model,
    messages: [],
    operation: {
      kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
      input: {
        prompt: "parse",
        attachments: [
          {
            mimeType: "application/pdf",
            data: "data:application/pdf;base64,AA==",
            fileName: "input.pdf",
          },
        ],
      },
    },
  });
  assert.equal(multimodalParse.operation.input.attachments[0].fileName, "input.pdf");
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: {
          kind: MODEL_OPERATION_KIND.MULTIMODAL_PARSE,
          input: {
            prompt: "parse",
            attachment: {
              mimeType: "application/pdf",
              data: "data:application/pdf;base64,AA==",
            },
          },
        },
      }),
    /unsupported fields: attachment/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: { kind: "web_search", input: {} },
      }),
    /input\.query is required/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: {
          kind: "image_generation",
          input: { prompt: "draw" },
          options: { apiType: "legacy" },
        },
      }),
    /unsupported image generation api type/,
  );
  assert.throws(
    () =>
      createModelRequest({
        invocation,
        model,
        messages: [],
        operation: { kind: "chat", input: { legacy: true } },
      }),
    /unsupported fields: legacy/,
  );
});

test("model operation results are validated by operation kind", () => {
  const output = { text: "ok", reasoning: "", toolCalls: [], finishReason: "stop", usage: {} };
  const response = createModelResponse({
    invocation,
    operationKind: MODEL_OPERATION_KIND.WEB_SEARCH,
    output,
    result: { rawText: "answer", output: [{ type: "message" }] },
    attempts: [{ attempt: 1, status: "completed", kind: "web_search", streaming: false, output }],
    model,
    provider: { providerId: "openai", adapterId: "openai-compatible", format: "openai_compatible" },
  });
  assert.equal(validateModelResponse(response), response);
  assert.throws(
    () =>
      createModelResponse({
        invocation,
        operationKind: MODEL_OPERATION_KIND.WEB_SEARCH,
        output,
        result: { imageArtifacts: [] },
        attempts: [
          { attempt: 1, status: "completed", kind: "web_search", streaming: false, output },
        ],
        model,
      }),
    /unsupported fields: imageArtifacts/,
  );
});

test("model response accepts only the canonical protocol shape", () => {
  const output = { text: "ok", reasoning: "", toolCalls: [], finishReason: "stop", usage: {} };
  const response = createModelResponse({
    invocation,
    output,
    attempts: [{ attempt: 1, status: "completed", kind: "response", streaming: false, output }],
    model,
    provider: { providerId: "openai", adapterId: "openai-compatible", format: "openai_compatible" },
  });
  assert.equal(validateModelResponse(response), response);
  assert.throws(
    () => validateModelResponse({ ...response, content: "legacy" }),
    /unsupported fields: content/,
  );
  assert.throws(
    () => validateModelResponse({ ...response, output: { text: "ok" } }),
    /reasoning must be a string/,
  );
});

test("model request requires one explicit context sequence policy", () => {
  assert.throws(
    () =>
      createModelRequest({
        invocation: { ...invocation, contextSequencePolicy: "" },
        model,
        messages: [],
      }),
    /invalid model context sequence policy: missing/,
  );
  assert.equal(
    createModelRequest({ invocation, model, messages: [] }).invocation.contextSequencePolicy,
    MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
  );
});

test("model request requires transport identity and derives provider/adapter identities", () => {
  assert.throws(
    () => createModelRequest({ invocation, model: { ...model, format: "" }, messages: [] }),
    /model spec.format is required/,
  );
  const derived = createModelRequest({
    invocation,
    model: { ...model, providerId: "", adapterId: "", operatorId: "openai" },
    messages: [],
  });
  assert.equal(derived.model.providerId, "openai");
  assert.equal(derived.model.adapterId, "openai-compatible");
});
