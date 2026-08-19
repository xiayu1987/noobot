/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage } from "@langchain/core/messages";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";

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
    .map((call = {}) => {
      const contextPolicy = resolveToolContextPolicy(call);
      return {
        id: String(call?.id || ""),
        type: "function",
        function: {
          name: String(call?.name || ""),
          arguments: JSON.stringify(call?.args || {}),
        },
        ...(contextPolicy ? { contextPolicy } : {}),
      };
    })
    .filter((call) => call.function.name);
}

export function formatToolCallsForLangChain(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((call = {}) => {
      const contextPolicy = resolveToolContextPolicy(call);
      return {
        id: String(call?.id || ""),
        name: String(call?.name || ""),
        args: call?.args || {},
        type: "tool_call",
        ...(contextPolicy ? { contextPolicy } : {}),
      };
    })
    .filter((call) => call.name);
}

export function buildAssistantModelMessageForToolCalls({
  ai = {},
  contentText = "",
  toolCalls = [],
  noobotMessageId = "",
} = {}) {
  const rawContent =
    typeof ai?.content === "string" || Array.isArray(ai?.content)
      ? ai.content
      : String(contentText || "");
  const additionalKwargs = clonePlainObjectWithoutToolCalls(ai?.additional_kwargs) || {};
  const canonicalMessageId = String(noobotMessageId || "").trim();
  if (canonicalMessageId) additionalKwargs.noobotMessageId = canonicalMessageId;
  return new AIMessage({
    content: rawContent,
    tool_calls: formatToolCallsForLangChain(toolCalls),
    additional_kwargs: additionalKwargs,
    response_metadata: clonePlainObjectWithoutToolCalls(ai?.response_metadata) || {},
  });
}
