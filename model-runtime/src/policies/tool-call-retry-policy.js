/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveFinishReason } from "../normalization/response-normalizer.js";
export function isToolCallStreamingMismatch(response, { toolCalls, invalidToolCalls }) {
  if (!Array.isArray(toolCalls) || !Array.isArray(invalidToolCalls)) {
    throw new TypeError("tool call mismatch classification requires classified tool calls");
  }
  if (toolCalls.length || invalidToolCalls.length) return false;
  return resolveFinishReason(response) === "tool_calls";
}
