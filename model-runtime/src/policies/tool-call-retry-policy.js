/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveFinishReason } from "../normalization/response-normalizer.js";
export function isToolCallStreamingMismatch(response = {}, toolCalls = []) {
  return !toolCalls.length && resolveFinishReason(response) === "tool_calls";
}
