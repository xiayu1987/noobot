/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function toLangChainToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") return null;
      if (toolCall.name) {
        return {
          id: toolCall.id || "",
          name: toolCall.name,
          args: toolCall.args || {},
          type: "tool_call",
        };
      }
      const fn = toolCall.function || {};
      let args = {};
      try {
        args =
          typeof fn.arguments === "string" ? JSON.parse(fn.arguments || "{}") : fn.arguments || {};
      } catch {
        args = {};
      }
      if (!fn.name) return null;
      return {
        id: toolCall.id || "",
        name: fn.name,
        args,
        type: "tool_call",
      };
    })
    .filter(Boolean);
}
