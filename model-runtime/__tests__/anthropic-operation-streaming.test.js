/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { anthropicMessagesAdapter } from "../src/index.js";

const modelSpec = {
  model: "claude",
  modelFamily: "claude",
  operatorId: "anthropic",
  base_url: "https://provider.test/v1",
  reasoning_effort_parameter: "reasoning_effort",
  reasoning_effort_options: ["none"],
};

function response(content, stopReason, streaming) {
  const message = {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude",
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  const events = [
    { type: "message_start", message: { ...message, content: [], stop_reason: null } },
    ...content.flatMap((block, index) => [
      { type: "content_block_start", index, content_block: block },
      { type: "content_block_stop", index },
    ]),
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(
    streaming
      ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
      : JSON.stringify(message),
    {
      headers: {
        "content-type": streaming ? "text/event-stream" : "application/json",
      },
    },
  );
}

for (const streaming of [false, true]) {
  test(`Claude search continuation preserves mode and sources: streaming=${streaming}`, async () => {
    const requests = [];
    const result = await anthropicMessagesAdapter.executeOperation({
      modelSpec,
      streaming,
      credential: "test-key",
      signal: new AbortController().signal,
      operation: { kind: "web_search", input: { query: "query" } },
      fetch: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return requests.length === 1
          ? response(
              [
                {
                  type: "web_search_tool_result",
                  tool_use_id: "s1",
                  content: [
                    { type: "web_search_result", title: "source", url: "https://source.test" },
                  ],
                },
              ],
              "pause_turn",
              streaming,
            )
          : response([{ type: "text", text: "done" }], "end_turn", streaming);
      },
    });
    assert.deepEqual(
      requests.map((item) => item.stream),
      [streaming, streaming],
    );
    assert.equal(requests[1].messages[1].role, "assistant");
    assert.deepEqual(result, {
      rawText: "done",
      sources: [{ title: "source", url: "https://source.test" }],
    });
  });

  test(`Claude search tool error reaches provider classification: streaming=${streaming}`, async () => {
    await assert.rejects(
      anthropicMessagesAdapter.executeOperation({
        modelSpec,
        streaming,
        credential: "test-key",
        signal: new AbortController().signal,
        operation: { kind: "web_search", input: { query: "query" } },
        fetch: async () =>
          response(
            [
              {
                type: "web_search_tool_result",
                tool_use_id: "s1",
                content: { type: "web_search_tool_result_error", error_code: "query_too_long" },
              },
            ],
            "end_turn",
            streaming,
          ),
      }),
      (error) => {
        const classification = anthropicMessagesAdapter.classifyError(error, {
          operatorId: "anthropic",
          clock: { now: () => 0 },
        });
        assert.equal(classification.kind, "invalid_request");
        assert.equal(classification.providerEvidence.recognized, true);
        assert.equal(classification.providerEvidence.modeRelated, false);
        return true;
      },
    );
  });
}
