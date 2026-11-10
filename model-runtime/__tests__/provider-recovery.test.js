/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor, openAiCompatibleAdapter } from "../src/index.js";
import { APIError } from "openai";
import { invocation } from "./runtime-fixtures.js";

function executorWithResponse(model, respond) {
  const requests = [];
  const events = [];
  const sleeps = [];
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (event, payload) => events.push({ event, ...payload }) },
    clock: { now: () => 0, sleep: async (ms) => sleeps.push(ms) },
    providerRuntime: {
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return respond(requests.length);
      },
    },
  });
  return {
    requests,
    events,
    sleeps,
    invoke: (operation) =>
      executor.invoke({
        invocation,
        operation,
        model: {
          ...model,
          reasoning_effort: "none",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          reasoning_effort_parameter: "reasoning_effort",
        },
        messages: [{ role: "user", content: "hello" }],
        options: { streaming: false },
        policies: { retry: { maxTotalAttempts: 3, transport: { maxAttempts: 2, baseDelayMs: 0 } } },
      }),
  };
}

const openai = {
  model: "gpt-test",
  operatorId: "openai",
  adapterId: "openai-compatible",
  base_url: "https://api.openai.com/v1",
  use_responses_api: true,
  capabilities: { web_search: true },
};

const operations = [
  { kind: "chat" },
  { kind: "web_search", input: { query: "hello" } },
  {
    kind: "multimodal_parse",
    input: {
      prompt: "describe",
      attachments: [{ mimeType: "image/png", data: "data:image/png;base64,AA==" }],
    },
  },
];

for (const retryAfter of ["2", "Thu, 01 Jan 1970 00:00:02 GMT"]) {
  test(`provider retry-after ${retryAfter} uses the executor clock`, async () => {
    const ctx = executorWithResponse(openai, () =>
      Response.json(
        { error: { code: "rate_limit_exceeded", message: "rate limited" } },
        { status: 429, headers: { "retry-after": retryAfter } },
      ),
    );
    await assert.rejects(ctx.invoke(), /rate limited/);
    assert.equal(ctx.requests.length, 2);
    assert.deepEqual(ctx.sleeps, [2000]);
    assert.equal(
      ctx.requests.every((request) => request.stream === false),
      true,
    );
  });
}

test("SDK error details retain provider scope across shared transport", () => {
  const error = new APIError(429, {
    type: "rate_limit_error",
    message: "spending cap",
    details: { error_code: "enforced_spend_limit_reached" },
  });
  for (const [operatorId, kind] of [
    ["anthropic", "quota_exhausted"],
    ["generic", "unknown"],
  ]) {
    const classification = openAiCompatibleAdapter.classifyError(error, {
      operatorId,
      clock: { now: () => 0 },
    });
    assert.equal(classification.kind, kind);
  }
});

for (const contentType of ["application/json", "text/plain"]) {
  test(`malformed Responses ${contentType} fails once as protocol`, async () => {
    const ctx = executorWithResponse(
      openai,
      () =>
        new Response('{"status":"completed"}', {
          headers: { "content-type": contentType },
        }),
    );
    await assert.rejects(ctx.invoke(), (error) => error.kind === "protocol");
    assert.equal(ctx.requests.length, 1);
    assert.deepEqual(ctx.sleeps, []);
    assert.equal(ctx.events.at(-1).kind, "protocol");
  });
}

for (const [code, kind, calls] of [
  ["insufficient_quota", "quota_exhausted", 1],
  ["server_error", "temporary_unavailable", 2],
]) {
  test(`non-stream Responses failed ${code} retains upstream classification`, async () => {
    const ctx = executorWithResponse(openai, () =>
      Response.json({
        id: "resp-failed",
        object: "response",
        status: "failed",
        output: [],
        error: { code, message: "upstream failure" },
      }),
    );
    await assert.rejects(ctx.invoke(), (error) => error.code === code);
    assert.equal(ctx.requests.length, calls);
    assert.equal(
      ctx.requests.every((request) => request.stream === false),
      true,
    );
    assert.equal(ctx.events.at(-1).kind, kind);
  });
}

test("invalid JSON from the SDK remains a protocol failure without replay", async () => {
  const ctx = executorWithResponse(
    openai,
    () =>
      new Response("{broken", {
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(ctx.invoke(), { kind: "protocol" });
  assert.equal(ctx.requests.length, 1);
  assert.deepEqual(ctx.sleeps, []);
});

for (const operation of operations) {
  test(`Responses ${operation.kind} and measurement share one JSON decode`, async (t) => {
    const body = JSON.stringify({
      id: "resp-completed",
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          id: "msg-1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
    });
    const parse = JSON.parse;
    let decodes = 0;
    t.mock.method(JSON, "parse", (...args) => {
      if (args[0] === body) decodes += 1;
      return parse(...args);
    });
    const ctx = executorWithResponse(
      openai,
      () =>
        new Response(body, {
          headers: { "content-type": "application/json" },
        }),
    );
    const result = await ctx.invoke(operation);
    assert.equal(operation.kind === "chat" ? result.output.text : result.result.rawText, "ok");
    assert.equal(decodes, 1);
    assert.equal(ctx.events.filter(({ event }) => event === "model.request.usage").length, 1);
    assert.equal(ctx.events.filter(({ event }) => event === "model.request.finished").length, 1);
  });
}

for (const operation of operations) {
  test(`malformed ${operation.kind} output never enters conversion or recovery retries`, async () => {
    for (const output of [null, {}, [null], [{ type: "message", content: {} }]]) {
      const ctx = executorWithResponse(openai, () =>
        Response.json({
          id: "resp-invalid",
          status: "completed",
          output,
        }),
      );
      await assert.rejects(ctx.invoke(operation), { kind: "protocol" });
      assert.equal(ctx.requests.length, 1);
      assert.deepEqual(ctx.sleeps, []);
      assert.equal(ctx.events.filter(({ event }) => event === "model.request.finished").length, 1);
    }
  });
}

for (const code of ["rate_limit_exceeded", "vendor_extension"]) {
  test(`oversized retry-after prevents ${code} replay and scheduling`, async () => {
    const ctx = executorWithResponse(openai, () =>
      Response.json(
        { error: { code, message: "wait" } },
        { status: 429, headers: { "retry-after": "3000000" } },
      ),
    );
    await assert.rejects(ctx.invoke(), /retry wait exceeds the allowed budget/);
    assert.equal(ctx.requests.length, 1);
    assert.deepEqual(ctx.sleeps, []);
    assert.equal(
      ctx.events.filter(({ event }) => event.endsWith("retry") || event.endsWith("retry_scheduled"))
        .length,
      0,
    );
  });
}

test("Anthropic structured spending cap stops despite retry-after", async () => {
  const ctx = executorWithResponse(
    {
      model: "claude-test",
      modelFamily: "claude",
      operatorId: "anthropic",
      adapterId: "anthropic-messages",
      base_url: "https://api.anthropic.com/v1",
    },
    () =>
      Response.json(
        {
          type: "error",
          error: {
            type: "rate_limit_error",
            message: "spending limit reached",
            details: { error_code: "enforced_spend_limit_reached" },
          },
        },
        { status: 429, headers: { "retry-after": "1" } },
      ),
  );
  await assert.rejects(ctx.invoke(), /spending limit reached/);
  assert.equal(ctx.requests.length, 1);
  assert.deepEqual(ctx.sleeps, []);
  assert.equal(ctx.events.at(-1).kind, "quota_exhausted");
  assert.equal(ctx.events.at(-1).model.adapterId, "anthropic-messages");
});
