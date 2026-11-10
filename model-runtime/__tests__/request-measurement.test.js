/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_REQUEST_EVENT } from "@noobot/model-protocol";
import { createMeasuredFetch } from "../src/executor/request-measurement.js";
import { normalizeProviderUsage } from "../src/normalization/usage-normalizer.js";

const chatUsage = {
  prompt_tokens: 100,
  completion_tokens: 10,
  total_tokens: 110,
  prompt_tokens_details: { cached_tokens: 80 },
};
function harness(fetchImpl, previousBodies = new Map(), identity = {}) {
  const events = [];
  const fetch = createMeasuredFetch({
    fetchImpl,
    previousBodies,
    invocation: {
      invocationId: "i",
      sessionId: "s",
      parentSessionId: "",
      flow: "test",
      ...identity,
    },
    model: { model: identity.model || "m" },
    operationKind: "chat",
    attempt: () => 1,
    observe: (type, data) => events.push({ type, data }),
  });
  return { fetch, events };
}
const url = "https://provider.test/v1/chat/completions";
const json = (usage = chatUsage) =>
  Response.json({ choices: [{ index: 0, finish_reason: "stop" }], usage });
const eventData = (events, type) =>
  events.filter((event) => event.type === type).map(({ data }) => data);
function sse(text, bytewise = false) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("each HTTP request has one usage and terminal event; prefix compares UTF-8 bytes", async () => {
  const { fetch, events } = harness(async () => json());
  for (const body of ["中文A", "中文B"]) await (await fetch(url, { method: "POST", body })).text();
  const starts = eventData(events, MODEL_REQUEST_EVENT.STARTED);
  assert.notEqual(starts[0].transportRequestId, starts[1].transportRequestId);
  assert.equal(starts[0].prefix.baseline, "no_previous_request");
  assert.equal(starts[1].prefix.commonPrefixBytes, 6);
  assert.equal(starts[1].prefix.requestBodyBytes, 7);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE).length, 2);
  assert.equal(
    eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.cacheReadInputTokens.value,
    80,
  );
  assert.deepEqual(
    eventData(events, MODEL_REQUEST_EVENT.FINISHED).map(({ status }) => status),
    ["completed", "completed"],
  );
});

for (const newline of ["\n", "\r\n", "\r"]) {
  test(`chat stream parses byte boundaries and ${JSON.stringify(newline)} framing exactly once`, async () => {
    const wire =
      [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "你好" }, finish_reason: "stop" }] })}`,
        `data: ${JSON.stringify({ usage: chatUsage })}`,
        "data: [DONE]",
      ].join(newline.repeat(2)) + newline.repeat(2);
    const { fetch, events } = harness(async () => sse(wire, true));
    assert.equal(await (await fetch(url, { method: "POST", body: "{}" })).text(), wire);
    assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE).length, 1);
    assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED).length, 1);
    assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.outputTokens.value, 10);
  });
}

test("Anthropic stream merges cumulative usage rather than summing deltas", async () => {
  const wire = [
    {
      type: "message_start",
      message: {
        content: [],
        usage: {
          input_tokens: 9,
          output_tokens: 0,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      },
    },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    { type: "message_delta", usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ]
    .map((data) => `data: ${JSON.stringify(data)}\n\n`)
    .join("");
  const { fetch, events } = harness(async () => sse(wire));
  await (await fetch("https://provider.test/v1/messages", { method: "POST", body: "{}" })).text();
  const [{ usage }] = eventData(events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(usage.inputTokens.value, 69);
  assert.equal(usage.outputTokens.value, 7);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE).length, 1);
});

test("Responses terminal usage is recorded even when the consumer cancels after the terminal frame", async () => {
  const data = {
    type: "response.completed",
    response: {
      status: "completed",
      output: [],
      usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
    },
  };
  const { fetch, events } = harness(async () => sse(`data: ${JSON.stringify(data)}\n\n`));
  const reader = (
    await fetch("https://provider.test/v1/responses", { method: "POST", body: "{}" })
  ).body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE).length, 1);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.cacheReadInputTokens.value, 0);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status, "completed");
});

test("truncated streams preserve reported input but never report partial output as complete", async () => {
  const { fetch, events } = harness(async () =>
    sse(`data: ${JSON.stringify({ usage: chatUsage })}\n\n`),
  );
  await (await fetch(url, { method: "POST", body: "{}" })).text();
  const [{ usage }] = eventData(events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(usage.inputTokens.value, 100);
  assert.deepEqual(usage.outputTokens, { state: "unavailable", reason: "stream_interrupted" });
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status, "failed");
});

test("transport failure and abort have explicit missing usage and terminal status", async () => {
  for (const aborted of [false, true]) {
    const controller = new AbortController();
    if (aborted) controller.abort();
    const failure = new Error("transport failed");
    const { fetch, events } = harness(async () => {
      throw failure;
    });
    await assert.rejects(
      fetch(url, { method: "POST", body: "{}", signal: controller.signal }),
      (error) => error === failure,
    );
    assert.deepEqual(eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.inputTokens, {
      state: "unavailable",
      reason: "transport_failed",
    });
    assert.equal(
      eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status,
      aborted ? "cancelled" : "failed",
    );
  }
});

for (const aborted of [false, true]) {
  test(`consumer cancellation requires an aborted signal for cancelled status: ${aborted}`, async () => {
    const { fetch, events } = harness(
      async () =>
        new Response(new ReadableStream({ pull() {} }), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const controller = new AbortController();
    const response = await fetch(url, { method: "POST", body: "{}", signal: controller.signal });
    if (aborted) controller.abort();
    await response.body.cancel();
    assert.equal(
      eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status,
      aborted ? "cancelled" : "failed",
    );
    assert.equal(
      eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.outputTokens.reason,
      "stream_interrupted",
    );
  });
}

test("missing usage differs from reported zero and invalid values remain explicit errors", async () => {
  const { fetch, events } = harness(async () =>
    Response.json({ choices: [{ index: 0, finish_reason: "stop" }] }),
  );
  await (await fetch(url, { method: "POST", body: "{}" })).text();
  assert.equal(
    eventData(events, MODEL_REQUEST_EVENT.USAGE)[0].usage.inputTokens.reason,
    "provider_not_reported",
  );
  assert.equal(
    normalizeProviderUsage({ prompt_tokens: 0, completion_tokens: 0 }, "chat").inputTokens.value,
    0,
  );
  assert.throws(
    () => normalizeProviderUsage({ ...chatUsage, total_tokens: 999 }, "chat"),
    /total_tokens/,
  );
  const invalid = harness(async () => json({ ...chatUsage, prompt_tokens: -1 }));
  await (await invalid.fetch(url, { method: "POST", body: "{}" })).text();
  const [measurement] = eventData(invalid.events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(measurement.usage, null);
  assert.match(measurement.measurementError, /non-negative/);
});

test("prefix retains only the preceding body and clears unsupported-body baselines", async () => {
  const previousBodies = new Map();
  const { fetch, events } = harness(async () => json(), previousBodies);
  for (const body of ["abc-first", "abc-second", "abc-third"])
    await (await fetch(url, { method: "POST", body })).text();
  assert.equal(previousBodies.size, 1);
  assert.equal([...previousBodies.values()][0].toString(), "abc-third");
  await (await fetch(url, { method: "POST", body: new Uint8Array([1]) })).text();
  assert.equal(previousBodies.size, 0);
  await (await fetch(url, { method: "POST", body: "abc-fourth" })).text();
  const starts = eventData(events, MODEL_REQUEST_EVENT.STARTED);
  assert.deepEqual(starts[3].prefix, { state: "unavailable", reason: "unsupported" });
  assert.equal(starts[4].prefix.baseline, "no_previous_request");
});

test("prefix baselines are isolated by endpoint, model, session, parent and flow", async () => {
  const previousBodies = new Map();
  const original = harness(
    async (input) =>
      String(input).endsWith("/responses")
        ? Response.json({ status: "completed", output: [] })
        : json(),
    previousBodies,
  );
  await (await original.fetch(url, { method: "POST", body: "same-body" })).text();
  for (const identity of [
    { model: "other-model" },
    { sessionId: "other-session" },
    { parentSessionId: "other-parent" },
    { flow: "other-flow" },
  ]) {
    const isolated = harness(async () => json(), previousBodies, identity);
    await (await isolated.fetch(url, { method: "POST", body: "same-body" })).text();
    assert.equal(
      eventData(isolated.events, MODEL_REQUEST_EVENT.STARTED)[0].prefix.baseline,
      "no_previous_request",
    );
  }
  await (
    await original.fetch("https://other.test/v1/chat/completions", {
      method: "POST",
      body: "same-body",
    })
  ).text();
  await (
    await original.fetch("https://provider.test/v1/responses", {
      method: "POST",
      body: "same-body",
    })
  ).text();
  await (await original.fetch(url, { method: "POST", body: "same-body" })).text();
  const starts = eventData(original.events, MODEL_REQUEST_EVENT.STARTED);
  assert.equal(starts[1].prefix.baseline, "no_previous_request");
  assert.equal(starts[2].prefix.baseline, "no_previous_request");
  assert.equal(starts[3].prefix.commonPrefixBytes, 9);
});

test("HTTP errors preserve their body and never parse it as usage", async () => {
  const { fetch, events } = harness(async () => new Response("rate limited", { status: 429 }));
  const response = await fetch(url, { method: "POST", body: "{}" });
  assert.equal(response.status, 429);
  assert.equal(await response.text(), "rate limited");
  const [measurement] = eventData(events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(measurement.measurementError, null);
  assert.equal(measurement.usage.inputTokens.reason, "request_failed");
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status, "failed");
});

test("mixed-case SSE media types and real zero usage survive transport collection", async () => {
  const wire = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0 } })}\n\ndata: [DONE]\n\n`;
  const { fetch, events } = harness(
    async () =>
      new Response(wire, {
        headers: { "content-type": "Text/Event-Stream; charset=utf-8" },
      }),
  );
  assert.equal(await (await fetch(url, { method: "POST", body: "{}" })).text(), wire);
  const [measurement] = eventData(events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(measurement.measurementError, null);
  assert.deepEqual(measurement.usage.outputTokens, { state: "reported", value: 0 });
});

test("polling and downloads do not emit model request events or change prefix baselines", async () => {
  const previous = new Map();
  const { fetch, events } = harness(async () => json(), previous);
  await (await fetch(url, { method: "POST", body: "same" })).text();
  await (await fetch(url)).text();
  await (await fetch(new Request(url))).text();
  await (await fetch(url, { method: "GET" })).text();
  await (await fetch(url, { method: "POST", body: "same" })).text();
  const starts = eventData(events, MODEL_REQUEST_EVENT.STARTED);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].prefix.commonPrefixBytes, 4);
  assert.equal(previous.size, 1);
});

test("Request inputs preserve their body and use their cancellation signal", async () => {
  const controller = new AbortController();
  const request = new Request(url, { method: "POST", body: "payload", signal: controller.signal });
  const { fetch, events } = harness(async (input) => {
    assert.equal(await input.text(), "payload");
    return json();
  });
  await (await fetch(request)).text();
  assert.deepEqual(eventData(events, MODEL_REQUEST_EVENT.STARTED)[0].prefix, {
    state: "unavailable",
    reason: "unsupported",
  });
  controller.abort();
  const aborted = harness(async () => {
    throw controller.signal.reason;
  });
  await assert.rejects(
    aborted.fetch(
      new Request(url, {
        method: "POST",
        body: "payload",
        signal: controller.signal,
      }),
    ),
  );
  assert.equal(eventData(aborted.events, MODEL_REQUEST_EVENT.FINISHED)[0].status, "cancelled");
});

test("invalid UTF-8 fails body consumption and records one failed terminal", async () => {
  const bytes = Uint8Array.of(0xff);
  const { fetch, events } = harness(async () => new Response(bytes));
  await assert.rejects(
    async () => (await fetch(url, { method: "POST" })).arrayBuffer(),
    (error) => error.kind === "protocol" && error.cause instanceof TypeError,
  );
  const [measurement] = eventData(events, MODEL_REQUEST_EVENT.USAGE);
  assert.equal(measurement.usage, null);
  assert.match(measurement.measurementError, /UTF-8/);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED).length, 1);
  assert.equal(eventData(events, MODEL_REQUEST_EVENT.FINISHED)[0].status, "failed");
});
