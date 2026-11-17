/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SystemMessage, HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { createOpenAiCompatibleClient } from "@noobot/model-runtime/adapters";
import { capturePhaseSummarySnapshot } from "@noobot/context-protocol/policy/summary";

test("summary snapshot preserves roles, multimodal content and closed tool pairs through the real adapter", async () => {
  const content = [
    { type: "text", text: "原始任务\nkeep this" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
  ];
  const args = { nested: { text: '中文 "quoted"', values: [1, null, true] } };
  const blocks = {
    system: [new SystemMessage("system instructions")],
    history: [new HumanMessage({ content })],
    incremental: [
      new AIMessage({
        content: "inspect",
        tool_calls: [{ id: "call-1", name: "inspect", args, type: "tool_call" }],
      }),
      new ToolMessage({ content: "original tool result", tool_call_id: "call-1" }),
    ],
  };
  const snapshot = capturePhaseSummarySnapshot(blocks);
  const requests = [];
  const client = createOpenAiCompatibleClient({
    modelSpec: {
      model: "gpt-4o-mini",
      operatorId: "openai",
      adapterId: "openai-compatible",
      use_responses_api: false,
      reasoning_effort: "none",
      reasoning_effort_options: ["none"],
      reasoning_effort_parameter: "reasoning_effort",
    },
    credential: "test",
    streaming: true,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(
        'data: {"choices":[{"index":0,"delta":{"content":"summary"},"finish_reason":null}]}\n\n' +
          'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
          "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  client.completions.getNumTokens = async () => 1;
  const response = await client.invoke([
    ...structuredClone([...snapshot.system, ...snapshot.history, ...snapshot.incremental]),
    new HumanMessage("summarize"),
  ]);
  assert.equal(response.content, "summary");
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.stream, true);
  assert.equal(Object.hasOwn(request, "tools"), false);
  assert.deepEqual(
    request.messages.map((message) => message.role),
    ["system", "user", "assistant", "tool", "user"],
  );
  assert.equal(request.messages[0].content, "system instructions");
  assert.deepEqual(request.messages[1].content, content);
  assert.equal(request.messages[2].tool_calls[0].id, "call-1");
  assert.deepEqual(JSON.parse(request.messages[2].tool_calls[0].function.arguments), args);
  assert.equal(request.messages[3].tool_call_id, "call-1");
  assert.equal(request.messages[3].content, "original tool result");
  assert.deepEqual(capturePhaseSummarySnapshot(blocks), snapshot);
});
