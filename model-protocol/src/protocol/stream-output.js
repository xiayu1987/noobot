/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const hasText = (value) => typeof value === "string" && value.length > 0;
const hasToolCall = (call) =>
  hasText(call?.id) || hasText(call?.function?.name) || hasText(call?.function?.arguments);

const RESPONSE_DELTA_TYPES = new Set([
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
]);
const RESPONSE_TOOL_TYPES = new Set([
  "function_call",
  "custom_tool_call",
  "web_search_call",
  "file_search_call",
  "code_interpreter_call",
  "image_generation_call",
  "computer_call",
  "mcp_call",
  "local_shell_call",
  "shell_call",
  "apply_patch_call",
  "tool_search_call",
  "mcp_approval_request",
]);
const ANTHROPIC_OUTPUT_BLOCKS = new Set(["tool_use", "server_tool_use", "redacted_thinking"]);

function hasResponsesOutput(event) {
  if (event.type === "response.shell_call_output_content.delta")
    return hasText(event.delta?.stdout) || hasText(event.delta?.stderr);
  if (RESPONSE_DELTA_TYPES.has(event.type)) return hasText(event.delta);
  if (["response.content_part.added", "response.reasoning_summary_part.added"].includes(event.type))
    return hasText(event.part?.text) || hasText(event.part?.refusal);
  if (event.type !== "response.output_item.added") return false;
  const item = event.item;
  return (
    RESPONSE_TOOL_TYPES.has(item?.type) ||
    hasText(item?.encrypted_content) ||
    (item?.content ?? []).some((part) => hasText(part.text) || hasText(part.refusal)) ||
    (item?.summary ?? []).some((part) => hasText(part.text))
  );
}

export function hasModelStreamOutput(format, event) {
  if (format === "chat") {
    return (event.choices ?? []).some(
      ({ delta }) =>
        hasText(delta?.content) ||
        hasText(delta?.reasoning_content) ||
        hasText(delta?.reasoning) ||
        hasText(delta?.refusal) ||
        (delta?.tool_calls ?? []).some(hasToolCall) ||
        hasText(delta?.function_call?.name) ||
        hasText(delta?.function_call?.arguments),
    );
  }
  if (format === "responses") {
    return hasResponsesOutput(event);
  }
  if (format === "anthropic") {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      return (
        hasText(block?.text) || hasText(block?.thinking) || ANTHROPIC_OUTPUT_BLOCKS.has(block?.type)
      );
    }
    return (
      event.type === "content_block_delta" &&
      (hasText(event.delta?.text) ||
        hasText(event.delta?.thinking) ||
        hasText(event.delta?.partial_json))
    );
  }
  return false;
}
