/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";

import {
  decodeBodyByEncoding,
  extractAnthropicContent,
  extractResponsesOutput,
  resolveFinalResponseBodyText,
} from "../src/response-body.js";
import { normalizeUsageCacheDiagnostics } from "../src/cache-diagnostics.js";

test("decodes declared content encodings in reverse order and propagates corrupt or unsupported encodings", async () => {
  const raw = Buffer.from('{"ok":true}');
  for (const [encoding, encode] of [
    ["gzip", gzipSync],
    ["deflate", deflateSync],
    ["br", brotliCompressSync],
  ]) {
    assert.deepEqual(await decodeBodyByEncoding(encode(raw), encoding), raw);
    await assert.rejects(decodeBodyByEncoding(Buffer.from("corrupt"), encoding));
  }
  assert.deepEqual(await decodeBodyByEncoding(brotliCompressSync(gzipSync(raw)), "gzip, br"), raw);
  assert.equal(await decodeBodyByEncoding(raw, "identity"), raw);
  assert.equal(await decodeBodyByEncoding(raw), raw);
  await assert.rejects(decodeBodyByEncoding(raw, "unknown"), /unsupported content encoding/);
  assert.throws(() => resolveFinalResponseBodyText("{invalid", "application/json"), SyntaxError);
});

test("projects interleaved SSE tool call fragments in index order, including argument-only deltas", () => {
  const frame = (tool_calls) =>
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls } }] })}\n\n`;
  const body =
    frame([
      { index: 1, id: "b", function: { name: "write", arguments: '{"b":' } },
      { index: 0, id: "a", function: { name: "read", arguments: '{"a":' } },
    ]) +
    frame([
      { index: 0, function: { arguments: "1}" } },
      { index: 1, function: { arguments: "2}" } },
    ]) +
    "data: [DONE]\n\n";
  assert.deepEqual(JSON.parse(resolveFinalResponseBodyText(body, "text/event-stream")), {
    type: "tool_calls",
    tool_calls: [
      { id: "a", type: "function", function: { name: "read", arguments: '{"a":1}' } },
      { id: "b", type: "function", function: { name: "write", arguments: '{"b":2}' } },
    ],
  });
});

test("projects OpenAI Responses function calls without logging the full response envelope", () => {
  const payload = {
    id: "resp-1",
    tools: Array.from({ length: 13 }, (_, index) => ({ name: `tool-${index}` })),
    usage: { attribution: { items: { huge: "diagnostic" } } },
    output: [
      { type: "reasoning", encrypted_content: "secret", summary: [] },
      {
        type: "function_call",
        id: "fc-1",
        call_id: "call-1",
        name: "read_file",
        arguments: '{"filePath":"README.md"}',
      },
    ],
  };

  const projection = resolveFinalResponseBodyText(JSON.stringify(payload), "application/json");
  assert.deepEqual(JSON.parse(projection), {
    type: "tool_calls",
    tool_calls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "read_file", arguments: '{"filePath":"README.md"}' },
      },
    ],
  });
  assert.equal(projection.includes("encrypted_content"), false);
  assert.equal(projection.includes("attribution"), false);
});

test("projects Anthropic Messages text, thinking, and tool_use blocks", () => {
  const payload = {
    id: "msg-1",
    content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "tool_use", id: "tool-1", name: "read_file", input: { filePath: "README.md" } },
    ],
  };
  const projection = extractAnthropicContent(payload);
  assert.deepEqual(projection.toolCalls[0], {
    id: "tool-1",
    type: "function",
    function: { name: "read_file", arguments: '{"filePath":"README.md"}' },
  });
  assert.equal(projection.reasoning[0], "private reasoning");
  assert.deepEqual(extractResponsesOutput(payload), { text: "", toolCalls: [], reasoning: [] });
});

test("keeps ordinary provider errors available when no known response projection exists", () => {
  const body = JSON.stringify({ error: { type: "invalid_request_error", message: "bad input" } });
  assert.match(resolveFinalResponseBodyText(body, "application/json"), /invalid_request_error/);
  assert.match(resolveFinalResponseBodyText(body, "application/json"), /bad input/);
});

test("projects OpenAI chat SSE deltas across CR-framed events and skips [DONE]", () => {
  const chunk = (content) => JSON.stringify({ choices: [{ delta: { content } }] });
  const body = `data: ${chunk("Hel")}\r\rdata: ${chunk("lo")}\r\n\r\ndata: [DONE]\n\n`;
  assert.equal(resolveFinalResponseBodyText(body, "text/event-stream"), "Hello");
});

test("joins multi-line SSE data into one payload", () => {
  const body = 'data: {"choices":[{"delta":\ndata: {"content":"ok"}}]}\n\n';
  assert.equal(resolveFinalResponseBodyText(body, "text/event-stream"), "ok");
});

test("ignores an SSE event without its terminating blank line", () => {
  const chunk = (content) => JSON.stringify({ choices: [{ delta: { content } }] });
  const body = `data: ${chunk("done")}\n\ndata: ${chunk(" partial")}`;
  assert.equal(resolveFinalResponseBodyText(body, "text/event-stream"), "done");
});

test("cache diagnostics project scalar usage facts without provider envelopes", () => {
  const diagnostics = normalizeUsageCacheDiagnostics({
    usage: {
      input_tokens: 100,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 80 },
      attribution: { items: { huge: { cached_tokens: 80 } } },
    },
  });

  assert.deepEqual(diagnostics, {
    inputTokens: 100,
    outputTokens: 7,
    totalTokens: 0,
    cachedInputTokens: 80,
    cacheCreationInputTokens: 0,
    cacheHit: true,
  });
});
