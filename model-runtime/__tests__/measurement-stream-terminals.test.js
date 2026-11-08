/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_REQUEST_EVENT } from "@noobot/model-protocol";
import { createMeasuredFetch } from "../src/executor/request-measurement.js";
import {
  collectResponsesStream,
  guardResponsesStream,
} from "../src/adapters/openai-responses-stream.js";

async function measure(path, frames, bytewise) {
  const wire = frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const bytes = new TextEncoder().encode(wire);
  const events = [];
  const fetch = createMeasuredFetch({
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            else controller.enqueue(bytes);
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    previousBodies: new Map(),
    invocation: { invocationId: "test" },
    model: { model: "test" },
    operationKind: "chat",
    attempt: () => 1,
    observe: (type, data) => events.push({ type, data }),
  });
  assert.equal(
    await (await fetch(`https://provider.test/v1/${path}`, { method: "POST", body: "{}" })).text(),
    wire,
  );
  assert.equal(events.filter(({ type }) => type === MODEL_REQUEST_EVENT.USAGE).length, 1);
  assert.equal(events.filter(({ type }) => type === MODEL_REQUEST_EVENT.FINISHED).length, 1);
  return {
    usage: events.find(({ type }) => type === MODEL_REQUEST_EVENT.USAGE).data,
    status: events.find(({ type }) => type === MODEL_REQUEST_EVENT.FINISHED).data.status,
  };
}

for (const bytewise of [false, true]) {
  for (const output of [0, 7]) {
    test(`Anthropic error invalidates provisional output ${output}; bytewise=${bytewise}`, async () => {
      const { usage, status } = await measure(
        "messages",
        [
          {
            type: "message_start",
            message: {
              content: [],
              usage: {
                input_tokens: 10,
                cache_read_input_tokens: 20,
                cache_creation_input_tokens: 5,
                output_tokens: 0,
              },
            },
          },
          { type: "message_delta", usage: { output_tokens: output } },
          { type: "error", error: { message: "failed" } },
          { type: "message_stop" },
        ],
        bytewise,
      );
      assert.equal(status, "failed");
      assert.equal(usage.measurementError, null);
      assert.deepEqual(usage.usage.inputTokens, { state: "reported", value: 35 });
      assert.deepEqual(usage.usage.outputTokens, {
        state: "unavailable",
        reason: "stream_interrupted",
      });
      assert.equal(usage.usage.cacheReadInputTokens.value, 20);
    });
  }
  for (const type of ["response.incomplete", "response.failed"]) {
    test(`${type} preserves terminal zero usage; bytewise=${bytewise}`, async () => {
      const { usage, status } = await measure(
        "responses",
        [
          {
            type,
            response: {
              status: type.slice("response.".length),
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          {
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 999, output_tokens: 999 } },
          },
        ],
        bytewise,
      );
      assert.equal(status, "failed");
      assert.equal(usage.measurementError, null);
      assert.deepEqual(usage.usage.outputTokens, { state: "reported", value: 0 });
      assert.equal(usage.usage.inputTokens.value, 10);
    });
  }
}

test("shared Responses guard rejects incomplete for ordinary streaming chat too", async () => {
  async function* stream() {
    yield { type: "response.output_text.delta", delta: "partial" };
    yield {
      type: "response.incomplete",
      response: {
        id: "resp_test",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
    };
  }
  const seen = [];
  await assert.rejects(async () => {
    for await (const event of guardResponsesStream(stream())) seen.push(event.type);
  }, /Responses response ended incomplete/);
  assert.deepEqual(seen, ["response.output_text.delta"]);
});

for (const collect of [false, true]) {
  test(`Responses terminal closes the upstream iterator without another read; collect=${collect}`, async () => {
    let closed = false;
    let readAfterTerminal = false;
    const response = { id: "resp_test", status: "completed", output: [] };
    async function* stream() {
      try {
        yield { type: "response.completed", response };
        readAfterTerminal = true;
        throw new Error("transport failed after completion");
      } finally {
        closed = true;
      }
    }
    if (collect) assert.equal(await collectResponsesStream(stream()), response);
    else {
      const events = [];
      for await (const event of guardResponsesStream(stream())) events.push(event);
      assert.deepEqual(events, [{ type: "response.completed", response }]);
    }
    assert.equal(closed, true);
    assert.equal(readAfterTerminal, false);
  });
}
