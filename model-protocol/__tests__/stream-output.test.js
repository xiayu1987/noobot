/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hasModelStreamOutput } from "../src/index.js";

for (const [label, delta, expected] of [
  ["role", { role: "assistant", content: "" }, false],
  ["empty", {}, false],
  ["text", { content: "hello" }, true],
  ["reasoning", { reasoning_content: "think" }, true],
  ["reasoning field", { reasoning: "think" }, true],
  ["refusal", { refusal: "denied" }, true],
  ["tool index", { tool_calls: [{ index: 0 }] }, false],
  ["tool identity", { tool_calls: [{ index: 0, id: "call-1" }] }, true],
  ["tool arguments", { tool_calls: [{ function: { arguments: "{}" } }] }, true],
  ["function", { function_call: { name: "run" } }, true],
])
  test(`Chat output progress: ${label}`, () => {
    assert.equal(hasModelStreamOutput("chat", { choices: [{ delta }] }), expected);
  });

for (const type of [
  "response.output_text.delta",
  "response.refusal.delta",
  "response.reasoning_text.delta",
  "response.reasoning_summary_text.delta",
  "response.function_call_arguments.delta",
  "response.custom_tool_call_input.delta",
  "response.mcp_call_arguments.delta",
  "response.code_interpreter_call_code.delta",
  "response.audio.delta",
  "response.audio.transcript.delta",
  "response.shell_call_command.delta",
]) {
  test(`Responses output progress: ${type}`, () => {
    assert.equal(hasModelStreamOutput("responses", { type, delta: "" }), false);
    assert.equal(hasModelStreamOutput("responses", { type, delta: "x" }), true);
  });
}

test("Responses shell output uses stdout and stderr fields", () => {
  for (const [delta, expected] of [
    [{}, false],
    [{ stdout: "", stderr: "" }, false],
    [{ stdout: "result" }, true],
    [{ stderr: "error" }, true],
  ])
    assert.equal(
      hasModelStreamOutput("responses", {
        type: "response.shell_call_output_content.delta",
        delta,
      }),
      expected,
    );
});

test("Responses initial content and reasoning independently advance output", () => {
  for (const item of [
    { content: [{ text: "hello" }] },
    { content: [], summary: [{ text: "think" }] },
    { encrypted_content: "opaque" },
  ])
    assert.equal(
      hasModelStreamOutput("responses", {
        type: "response.output_item.added",
        item,
      }),
      true,
    );
});

test("Responses lifecycle metadata is not output; tool execution is output", () => {
  assert.equal(hasModelStreamOutput("responses", { type: "response.created" }), false);
  assert.equal(
    hasModelStreamOutput("responses", {
      type: "response.output_item.added",
      item: { type: "message", content: [] },
    }),
    false,
  );
  for (const type of ["function_call", "web_search_call", "mcp_call"])
    assert.equal(
      hasModelStreamOutput("responses", {
        type: "response.output_item.added",
        item: { type },
      }),
      true,
    );
});

test("Anthropic output progress includes reasoning and tools, excludes empty text and signatures", () => {
  for (const [block, expected] of [
    [{ type: "text", text: "" }, false],
    [{ type: "text", text: "hello" }, true],
    [{ type: "thinking", thinking: "" }, false],
    [{ type: "tool_use", id: "call" }, true],
    [{ type: "redacted_thinking", data: "opaque" }, true],
  ])
    assert.equal(
      hasModelStreamOutput("anthropic", {
        type: "content_block_start",
        content_block: block,
      }),
      expected,
    );
  for (const [delta, expected] of [
    [{ type: "text_delta", text: "" }, false],
    [{ type: "thinking_delta", thinking: "think" }, true],
    [{ type: "input_json_delta", partial_json: "{}" }, true],
    [{ type: "signature_delta", signature: "sig" }, false],
  ])
    assert.equal(
      hasModelStreamOutput("anthropic", {
        type: "content_block_delta",
        delta,
      }),
      expected,
    );
  assert.equal(hasModelStreamOutput("anthropic", { type: "message_start" }), false);
});
