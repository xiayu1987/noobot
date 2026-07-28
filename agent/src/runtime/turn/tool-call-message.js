/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage } from "@langchain/core/messages";

function clonePlainObjectWithoutToolCalls(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cloned = { ...value };
  delete cloned.tool_calls;
  delete cloned.toolCalls;
  delete cloned.function_call;
  return cloned;
}

export function formatToolCallsForStorage(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((call = {}) => ({
      id: String(call?.id || ""),
      type: "function",
      function: {
        name: String(call?.name || ""),
        arguments: JSON.stringify(call?.args || {}),
      },
    }))
    .filter((call) => call.function.name);
}

export function formatToolCallsForLangChain(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((call = {}) => ({
      id: String(call?.id || ""),
      name: String(call?.name || ""),
      args: call?.args || {},
      type: "tool_call",
    }))
    .filter((call) => call.name);
}

export function buildAssistantModelMessageForToolCalls({
  ai = {},
  contentText = "",
  toolCalls = [],
} = {}) {
  const rawContent =
    typeof ai?.content === "string" || Array.isArray(ai?.content)
      ? ai.content
      : String(contentText || "");
  return new AIMessage({
    content: rawContent,
    tool_calls: formatToolCallsForLangChain(toolCalls),
    additional_kwargs: clonePlainObjectWithoutToolCalls(ai?.additional_kwargs) || {},
    response_metadata: clonePlainObjectWithoutToolCalls(ai?.response_metadata) || {},
  });
}
