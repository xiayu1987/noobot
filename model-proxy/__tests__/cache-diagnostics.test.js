/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequestPrefixTracker, measureResponseUsage } from "../src/cache-diagnostics.js";

const chatUrl = new URL("http://upstream.test/v1/chat/completions");
const context = { sessionId: "s", parentSessionId: "", flowName: "agent.main", modelName: "m" };
const reported = (value) => ({ state: "reported", value });

test("request prefix compares UTF-8 bytes against the previous body of the same scope", () => {
  const measure = createRequestPrefixTracker();
  const first = measure({ url: chatUrl, bodyText: '{"model":"m","a":"中文A"}', context });
  assert.deepEqual(first.prefix, {
    state: "reported",
    requestBodyBytes: Buffer.byteLength('{"model":"m","a":"中文A"}'),
    commonPrefixBytes: 0,
    baseline: "no_previous_request",
  });
  const second = measure({ url: chatUrl, bodyText: '{"model":"m","a":"中文B"}', context });
  assert.equal(second.prefix.baseline, "available");
  assert.equal(second.prefix.commonPrefixBytes, Buffer.byteLength('{"model":"m","a":"中文'));
  const otherSession = measure({
    url: chatUrl,
    bodyText: '{"model":"m"}',
    context: { ...context, sessionId: "other" },
  });
  assert.equal(otherSession.prefix.baseline, "no_previous_request");
});

test("JSON chat response projects cache read tokens in canonical fields", () => {
  const { usage } = measureResponseUsage({
    url: chatUrl,
    status: 200,
    contentType: "application/json",
    bodyText: JSON.stringify({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    }),
  });
  assert.deepEqual(usage.inputTokens, reported(100));
  assert.deepEqual(usage.outputTokens, reported(7));
  assert.deepEqual(usage.cacheReadInputTokens, reported(80));
  assert.equal(usage.cacheWriteInputTokens.reason, "unsupported");
});

test("SSE responses collect usage with runtime stream semantics", () => {
  const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const anthropic = measureResponseUsage({
    url: new URL("http://upstream.test/v1/messages"),
    status: 200,
    contentType: "text/event-stream",
    bodyText: sse([
      {
        type: "message_start",
        message: {
          usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 },
        },
      },
      { type: "message_delta", usage: { output_tokens: 3 } },
    ]),
  });
  assert.deepEqual(anthropic.usage.inputTokens, reported(95));
  assert.deepEqual(anthropic.usage.cacheReadInputTokens, reported(80));
  assert.deepEqual(anthropic.usage.cacheWriteInputTokens, reported(5));
  assert.deepEqual(anthropic.usage.outputTokens, reported(3));

  const responses = measureResponseUsage({
    url: new URL("http://upstream.test/v1/responses"),
    status: 200,
    contentType: "text/event-stream",
    bodyText: sse([
      { type: "response.created", response: { status: "in_progress" } },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { type: "message", content: [{ type: "output_text", text: "ok", annotations: [] }] },
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 2,
            input_tokens_details: { cached_tokens: 40 },
          },
        },
      },
    ]),
  });
  assert.deepEqual(responses.usage.cacheReadInputTokens, reported(40));

  const chat = measureResponseUsage({
    url: chatUrl,
    status: 200,
    contentType: "text/event-stream",
    bodyText: `${sse([
      { choices: [{ index: 0, delta: { content: "hi" } }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 1 } },
    ])}data: [DONE]\n\n`,
  });
  assert.deepEqual(chat.usage.inputTokens, reported(20));
});

test("unsupported, failed and invalid responses stay explicit without throwing", () => {
  assert.equal(
    measureResponseUsage({
      url: new URL("http://upstream.test/v1/models"),
      status: 200,
      bodyText: "{}",
    }).usage.inputTokens.reason,
    "unsupported",
  );
  assert.equal(
    measureResponseUsage({ url: chatUrl, status: 500, bodyText: "{}" }).usage.inputTokens.reason,
    "request_failed",
  );
  assert.equal(
    measureResponseUsage({
      url: chatUrl,
      status: 200,
      contentType: "application/json",
      bodyText: "{}",
    }).usage.inputTokens.reason,
    "provider_not_reported",
  );
  const invalid = measureResponseUsage({
    url: chatUrl,
    status: 200,
    contentType: "application/json",
    bodyText: JSON.stringify({ usage: { prompt_tokens: -1 } }),
  });
  assert.equal(invalid.usage, null);
  assert.match(invalid.measurementError, /non-negative/);
});
