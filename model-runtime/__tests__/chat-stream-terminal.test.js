/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createChatStreamTerminalTracker, ModelProtocolError } from "@noobot/model-protocol";
import { createOpenAiCompatibleClient } from "../src/adapters/openai-compatible-adapter.js";
import { guardChatResponseStream } from "../src/adapters/openai-chat-stream.js";

for (const finished of [false, true]) {
  for (const done of [false, true]) {
    test(`real Chat SDK rejects missing terminal: finish=${finished}, done=${done}`, async () => {
      const wire =
        `data: ${JSON.stringify({ id: "chat_test", object: "chat.completion.chunk", model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: finished ? "stop" : null }] })}\n\n` +
        (done ? "data: [DONE]\n\n" : "");
      const client = createOpenAiCompatibleClient({
        modelSpec: {
          model: "gpt-test",
          operatorId: "openai",
          adapterId: "openai-compatible",
          use_responses_api: false,
          reasoning_effort: "none",
          reasoning_effort_options: ["none"],
          reasoning_effort_parameter: "reasoning_effort",
        },
        credential: "test-key",
        streaming: true,
        fetch: async () => new Response(wire, { headers: { "content-type": "text/event-stream" } }),
      });
      const call = client.invoke("hello");
      if (finished && done) assert.equal((await call).content, "partial");
      else
        await assert.rejects(
          call,
          (error) =>
            error instanceof ModelProtocolError && /finish_reason.*\[DONE\]/.test(error.message),
        );
    });
  }
}

test("all observed choices require completion and usage-only chunks do not finish choices", () => {
  const tracker = createChatStreamTerminalTracker();
  assert.equal(
    tracker.accept({
      choices: [
        { index: 0, finish_reason: "stop" },
        { index: 1, finish_reason: null },
      ],
    }),
    null,
  );
  assert.equal(tracker.accept({ choices: [], usage: { completion_tokens: 7 } }), null);
  assert.equal(tracker.accept({ type: "[DONE]" }).status, "failed");
  assert.equal(tracker.accept({ choices: [{ index: 1, finish_reason: "stop" }] }).status, "failed");
  const empty = createChatStreamTerminalTracker();
  assert.equal(empty.accept({ type: "[DONE]" }).status, "failed");
});

test("Chat stream guard cancels its source on missing completion and preserves successful bytes", async () => {
  for (const finished of [false, true]) {
    let cancelled = false;
    const wire = `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finished ? "tool_calls" : null }] })}\n\ndata: [DONE]\n\n`;
    const response = guardChatResponseStream(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(wire));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    const reader = response.body.getReader();
    if (finished) {
      assert.equal(new TextDecoder().decode((await reader.read()).value), wire);
      await reader.cancel();
    } else await assert.rejects(reader.read(), ModelProtocolError);
    assert.equal(cancelled, true);
  }
});
