/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { projectToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";

export function toLangChainToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== "object") return null;
      if (toolCall.name) {
        return projectToolContextPolicy(
          {
            id: toolCall.id || "",
            name: toolCall.name,
            args: toolCall.args || {},
            type: "tool_call",
          },
          toolCall,
        );
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
      return projectToolContextPolicy(
        {
          id: toolCall.id || "",
          name: fn.name,
          args,
          type: "tool_call",
        },
        toolCall,
      );
    })
    .filter(Boolean);
}
