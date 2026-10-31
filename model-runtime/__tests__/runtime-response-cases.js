/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyToolCalls, createModelRequestExecutor } from "../src/index.js";
import { invocation, model } from "./runtime-fixtures.js";

test("reasoning-only exhaustion is a typed terminal protocol error", async () => {
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () => ({ content: "", additional_kwargs: { reasoning_content: "thinking" } }),
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });
  await assert.rejects(
    port.invoke({
      invocation,
      model,
      messages: [],
      policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
    }),
    (error) =>
      error?.code === "MODEL_REASONING_RETRY_EXHAUSTED" && error?.kind === "reasoning_only",
  );
});

test("reasoning-only retries are exposed through the canonical attempt trace", async () => {
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () =>
        ++calls === 1
          ? { content: "", additional_kwargs: { reasoning_content: "thinking" } }
          : { content: "final answer" },
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });
  const response = await port.invoke({
    invocation,
    model,
    messages: [],
    policies: { retry: { reasoningOnly: { maxAttempts: 1 } } },
  });
  assert.equal(response.output.text, "final answer");
  assert.equal(response.execution.attemptCount, 2);
  assert.deepEqual(
    response.execution.attempts.map(({ status, kind }) => ({ status, kind })),
    [
      { status: "retry", kind: "reasoning_only" },
      { status: "completed", kind: "response" },
    ],
  );
  assert.equal(response.execution.attempts[0].output.reasoning, "thinking");
});

test("empty signed thinking responses are retried before completion", async () => {
  let calls = 0;
  const adapter = {
    id: "anthropic-messages",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () =>
        ++calls === 1
          ? {
              content: [{ type: "thinking", thinking: "", signature: "signed" }],
              response_metadata: { finish_reason: "end_turn" },
            }
          : { content: "final answer" },
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    clock: { now: () => new Date(), sleep: async () => {} },
  });

  const response = await port.invoke({
    invocation,
    model,
    messages: [],
    policies: { retry: { emptyResponse: { maxAttempts: 1 } } },
  });

  assert.equal(calls, 2);
  assert.equal(response.output.text, "final answer");
  assert.deepEqual(
    response.execution.attempts.map(({ status, kind }) => ({ status, kind })),
    [
      { status: "retry", kind: "empty_response" },
      { status: "completed", kind: "response" },
    ],
  );
});

test("empty signed thinking response exhaustion is a typed protocol error", async () => {
  const adapter = {
    id: "anthropic-messages",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () => ({
        content: [{ type: "thinking", thinking: "", signature: "signed" }],
        response_metadata: { finish_reason: "end_turn" },
      }),
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    clock: { now: () => new Date(), sleep: async () => {} },
  });

  await assert.rejects(
    port.invoke({
      invocation,
      model,
      messages: [],
      policies: { retry: { emptyResponse: { maxAttempts: 1 } } },
    }),
    (error) =>
      error?.code === "MODEL_EMPTY_RESPONSE_RETRY_EXHAUSTED" && error?.kind === "empty_response",
  );
});

test("image-only chat output completes without an empty-response retry", async () => {
  let calls = 0;
  const adapter = {
    id: "openai-compatible",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () => {
        calls += 1;
        return {
          content: [{ type: "image_url", image_url: { url: "data:image/png;base64,ZmFrZQ==" } }],
          response_metadata: { finish_reason: "stop" },
        };
      },
    }),
  };
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
  });

  const response = await port.invoke({
    invocation,
    model,
    messages: [],
    policies: { retry: { emptyResponse: { maxAttempts: 1 } } },
  });

  assert.equal(calls, 1);
  assert.equal(response.output.text, "");
  assert.equal(response.execution.attempts[0]?.status, "completed");
  assert.equal(response.execution.attempts[0]?.kind, "response");
});

function createEmptyThenAnswerAdapter(emptyCount) {
  const state = { calls: 0 };
  const adapter = {
    id: "anthropic-messages",
    classifyError: () => ({ retryable: false }),
    bindTools: ({ client }) => client,
    prepareMessages: ({ messages }) => messages,
    createClient: () => ({
      invoke: async () =>
        ++state.calls <= emptyCount
          ? { content: "", response_metadata: { finish_reason: "stop" } }
          : { content: "final answer" },
    }),
  };
  return { adapter, state };
}

function createRecordingClock() {
  const sleeps = [];
  return { sleeps, clock: { now: () => new Date(), sleep: async (ms) => void sleeps.push(ms) } };
}

test("default empty-response policy retries with linear backoff until an answer arrives", async () => {
  const { adapter, state } = createEmptyThenAnswerAdapter(2);
  const { sleeps, clock } = createRecordingClock();
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    clock,
  });

  const response = await port.invoke({ invocation, model, messages: [] });

  assert.equal(state.calls, 3);
  assert.equal(response.output.text, "final answer");
  assert.deepEqual(sleeps, [500, 1000]);
  assert.deepEqual(
    response.execution.attempts.map(({ status, kind }) => ({ status, kind })),
    [
      { status: "retry", kind: "empty_response" },
      { status: "retry", kind: "empty_response" },
      { status: "completed", kind: "response" },
    ],
  );
});

test("default empty-response policy exhausts after three retries with a typed error", async () => {
  const { adapter, state } = createEmptyThenAnswerAdapter(Infinity);
  const { sleeps, clock } = createRecordingClock();
  const port = createModelRequestExecutor({
    registry: { resolve: () => adapter },
    credentialPort: { resolve: () => "secret" },
    clock,
  });

  await assert.rejects(
    port.invoke({ invocation, model, messages: [] }),
    (error) =>
      error?.code === "MODEL_EMPTY_RESPONSE_RETRY_EXHAUSTED" &&
      error?.kind === "empty_response" &&
      error?.details?.attemptCount === 4,
  );
  assert.equal(state.calls, 4);
  assert.deepEqual(sleeps, [500, 1000, 1500]);
});

test("tool call classification separates protocol-invalid calls from valid ones", () => {
  const { toolCalls, invalidToolCalls } = classifyToolCalls({
    content: "",
    tool_calls: [
      { id: "call_ok", name: "execute_script", args: { command: "ls" } },
      { id: "call_args_string", name: "execute_script", args: '{"command":"ls"}' },
      { id: "call_args_array", name: "execute_script", args: [] },
      { id: "call_no_name", name: "", args: {} },
    ],
  });

  assert.deepEqual(
    toolCalls.map(({ id }) => id),
    ["call_ok"],
  );
  assert.deepEqual(
    invalidToolCalls.map(({ index, id, name }) => ({ index, id, name })),
    [
      { index: 1, id: "call_args_string", name: "execute_script" },
      { index: 2, id: "call_args_array", name: "execute_script" },
      { index: 3, id: "call_no_name", name: "" },
    ],
  );
  invalidToolCalls.forEach(({ reason }) => assert.match(reason, /model tool call\[\d+]/));
});

test("provider invalid_tool_calls are classified instead of silently dropped", () => {
  const { toolCalls, invalidToolCalls } = classifyToolCalls({
    content: "",
    tool_calls: [{ id: "call_ok", name: "write_file", args: {} }],
    invalid_tool_calls: [{ id: "call_broken", name: "write_file", args: "{unparsable" }],
  });

  assert.deepEqual(
    toolCalls.map(({ id }) => id),
    ["call_ok"],
  );
  assert.deepEqual(
    invalidToolCalls.map(({ index, id }) => ({ index, id })),
    [{ index: 1, id: "call_broken" }],
  );
});
