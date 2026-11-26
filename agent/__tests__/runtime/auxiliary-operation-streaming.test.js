/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";
import { createAgentAuxiliaryModelPort } from "../../src/runtime/model-port-host.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";

function reply(payload, streaming) {
  return new Response(
    streaming
      ? payload.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
      : JSON.stringify(payload),
    {
      headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
    },
  );
}

for (const streaming of [false, true]) {
  for (const kind of ["multimodal_parse", "web_search", "media_generation"]) {
    test(`model host propagates turn streaming=${streaming} to ${kind} wire request`, async () => {
      const generating = kind === "media_generation";
      const requests = [];
      const runtime = createTestRuntimeContext({
        runConfig: { hookManager: null, streaming },
        sharedTools: {
          fetch: async (_url, init) => {
            requests.push(JSON.parse(init.body));
            if (generating)
              return reply(
                streaming
                  ? [{ type: "image_generation.completed", b64_json: "AQ==" }]
                  : { data: [{ b64_json: "AQ==" }] },
                streaming,
              );
            const message = {
              id: "msg-test",
              type: "message",
              role: "assistant",
              model: "claude",
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            };
            return reply(
              streaming
                ? [
                    {
                      type: "message_start",
                      message: { ...message, content: [], stop_reason: null },
                    },
                    {
                      type: "content_block_start",
                      index: 0,
                      content_block: { type: "text", text: "" },
                    },
                    {
                      type: "content_block_delta",
                      index: 0,
                      delta: { type: "text_delta", text: "done" },
                    },
                    { type: "content_block_stop", index: 0 },
                    {
                      type: "message_delta",
                      delta: { stop_reason: "end_turn", stop_sequence: null },
                      usage: { output_tokens: 1 },
                    },
                    { type: "message_stop" },
                  ]
                : message,
              streaming,
            );
          },
        },
      });
      const modelSpec = {
        model: generating ? "gpt-image-1" : "claude",
        adapterId: generating ? "openai-compatible" : "anthropic-messages",
        operatorId: generating ? "openai" : "anthropic",
        modelFamily: generating ? "gpt" : "claude",
        reasoning_effort_parameter: "reasoning_effort",
        reasoning_effort_options: ["none", "low", "medium", "high"],
        capabilities: { web_search: true },
        base_url: "https://provider.test/v1",
        api_key: "test-key",
        ...(generating
          ? {
              multimodal_generation: {
                support_generation: {
                  enabled: true,
                  api_type: "openai_images",
                  support_scope: ["image"],
                },
              },
            }
          : {}),
      };
      const port = createAgentAuxiliaryModelPort({
        modelSpec,
        modelState: {
          runtime,
          invocationIdentity: {
            sessionId: "s",
            parentSessionId: "",
            dialogProcessId: "d",
            turnScopeId: "t",
            runId: "r",
          },
        },
      });
      const operation =
        kind === "web_search"
          ? { kind, input: { query: "query" } }
          : generating
            ? { kind, input: { prompt: "bird", outputType: "image" } }
            : {
                kind,
                input: {
                  prompt: "parse",
                  attachments: [
                    {
                      mimeType: "image/png",
                      fileName: "a.png",
                      data: "data:image/png;base64,AQ==",
                    },
                  ],
                },
              };
      const result = await port.invoke({
        operation,
        options: { signal: runtime.abortSignal },
        invocation: {
          flow: "test",
          purpose: "test",
          domain: "test",
          contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
        },
      });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].stream === true, streaming);
      assert.equal(result.execution.attempts[0].streaming, streaming);
      if (generating) assert.equal(result.result.artifacts[0].contentBase64, "AQ==");
      else assert.equal(result.result.rawText, "done");
    });
  }
}
