/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractAnthropicContent,
  extractResponsesOutput,
  resolveFinalResponseBodyText,
} from "../src/response-body.js";
import { normalizeUsageCacheDiagnostics } from "../src/cache-diagnostics.js";

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
