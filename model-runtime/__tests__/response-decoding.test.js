/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "../src/index.js";
import { invocation } from "./runtime-fixtures.js";
import { guardChatResponseStream } from "../src/adapters/openai-chat-stream.js";
import { unwrapModelProtocolError } from "../src/adapters/response-mode.js";
import { createMeasuredFetch } from "../src/executor/request-measurement.js";

for (const format of ["chat", "responses", "anthropic"]) {
  for (const streaming of [false, true]) {
    for (const corruption of ["invalid UTF-8", "truncated UTF-8", "invalid JSON"]) {
      test(`${format} streaming=${streaming} rejects ${corruption} without retry or contradictory terminals`, async () => {
        const events = [];
        let requests = 0;
        let released = 0;
        const chat = {
          id: "chat-1",
          object: "chat.completion",
          model: "test",
          choices: [
            { index: 0, finish_reason: "stop", message: { role: "assistant", content: "PREFIX" } },
          ],
        };
        const responses = {
          id: "resp-1",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg-1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: "PREFIX", annotations: [] }],
            },
          ],
        };
        const anthropic = {
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: "test",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "PREFIX" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
        const data = JSON.stringify(
          format === "chat" ? chat : format === "responses" ? responses : anthropic,
        );
        let bytes = Buffer.from(streaming ? `data: ${data}\n\n` : data);
        if (corruption === "invalid UTF-8") bytes[bytes.indexOf("PREFIX")] = 0xff;
        else if (corruption === "truncated UTF-8")
          bytes = Buffer.concat([Buffer.from(streaming ? "data: " : ""), Buffer.of(0xe2)]);
        else bytes = Buffer.from(streaming ? "data: {invalid}\n\n" : "{invalid}");
        const executor = createModelRequestExecutor({
          credentialPort: { resolve: () => "test-key" },
          observationPort: { emit: (type, data) => events.push({ type, data }) },
          clock: {
            now: () => 0,
            sleep: async () => assert.fail("protocol failures must not wait"),
          },
          providerRuntime: {
            fetchImpl: async () => {
              requests += 1;
              let sent = false;
              return new Response(
                new ReadableStream({
                  pull(controller) {
                    if (sent) controller.close();
                    else {
                      sent = true;
                      controller.enqueue(bytes);
                    }
                  },
                  cancel() {
                    released += 1;
                  },
                }),
                {
                  headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
                },
              );
            },
          },
        });
        await assert.rejects(
          executor.invoke({
            invocation,
            model: {
              model: "test",
              operatorId: format === "anthropic" ? "anthropic" : "openai",
              modelFamily: format === "anthropic" ? "claude" : "gpt",
              use_responses_api: format === "responses",
              base_url: "https://provider.test/v1",
              reasoning_effort: "none",
              reasoning_effort_options: ["none"],
              reasoning_effort_parameter: "reasoning_effort",
            },
            messages: [{ role: "user", content: "hello" }],
            options: { streaming },
          }),
          (error) => {
            assert.equal(error.kind, "protocol");
            assert.match(
              error.message,
              corruption === "invalid JSON" ? /valid JSON/ : /valid UTF-8/,
            );
            assert.ok(
              error.cause instanceof (corruption === "invalid JSON" ? SyntaxError : TypeError),
            );
            return true;
          },
        );
        assert.equal(requests, 1);
        assert.ok(released <= 1);
        for (const type of ["model.request.finished", "model.invocation.failed"])
          assert.equal(events.filter((event) => event.type === type).length, 1);
        assert.equal(
          events.find((event) => event.type === "model.request.finished").data.status,
          "failed",
        );
        assert.equal(
          events.filter((event) => event.type === "model.invocation.completed").length,
          0,
        );
        const usage = events.filter((event) => event.type === "model.request.usage");
        assert.equal(usage.length, 1);
        assert.equal(usage[0].data.usage, null);
        assert.match(usage[0].data.measurementError, /valid (UTF-8|JSON)/);
      });
    }
  }
}

for (const bytes of [Buffer.of(0xff), Buffer.of(0xe2)]) {
  test(`standalone Chat guard preserves UTF-8 cause for ${bytes.toString("hex")}`, async () => {
    const response = guardChatResponseStream(new Response(bytes));
    await assert.rejects(
      response.text(),
      (error) => error.kind === "protocol" && error.cause instanceof TypeError,
    );
  });
}

test("unrelated SyntaxError is not inferred to be a provider JSON failure", () => {
  const error = new Error("local failure", { cause: new SyntaxError("local expression") });
  assert.equal(unwrapModelProtocolError(error), error);
});

test("decoding failure cancels an open upstream body and preserves its original cause", async () => {
  let cancelledWith;
  const events = [];
  const fetch = createMeasuredFetch({
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.of(0xff));
          },
          cancel(reason) {
            cancelledWith = reason;
          },
        }),
      ),
    previousBodies: new Map(),
    invocation,
    model: { model: "test" },
    operationKind: "chat",
    attempt: () => 1,
    observe: (type, data) => events.push({ type, data }),
  });
  const response = await fetch("https://provider.test/v1/chat/completions", {
    method: "POST",
    body: "{}",
  });
  await assert.rejects(
    response.text(),
    (error) => error === cancelledWith && error.cause instanceof TypeError,
  );
  assert.deepEqual(
    events.filter(({ type }) => type === "model.request.finished").map(({ data }) => data.status),
    ["failed"],
  );
});
