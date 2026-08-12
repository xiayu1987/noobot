/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function createToolResult(input = {}) {
  return Object.freeze({
    callId: String(input.callId || "").trim(),
    name: String(input.name || "").trim(),
    content: input.content,
    isError: input.isError === true,
  });
}
