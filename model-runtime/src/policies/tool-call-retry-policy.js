/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MODEL_RESPONSE_SOURCE, requireModelResponseSource } from "@noobot/model-protocol";
export function isToolCallStreamingMismatch(source, { toolCalls, finishReason, invalidToolCalls }) {
  if (!Array.isArray(toolCalls) || !Array.isArray(invalidToolCalls)) {
    throw new TypeError("tool call mismatch classification requires classified tool calls");
  }
  if (requireModelResponseSource(source) === MODEL_RESPONSE_SOURCE.RESPONSES) return false;
  if (toolCalls.length || invalidToolCalls.length) return false;
  return finishReason === "tool_calls";
}
