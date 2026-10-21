/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AIMessage } from "@langchain/core/messages";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { resolveToolContextPolicy } from "@noobot/context-protocol/tool/context-policy";
import { text, isPlainObject, isObjectLike } from "@noobot/shared/value";

function clonePlainObjectWithoutToolCalls(value = null) {
  if (!isPlainObject(value)) return null;
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

function resolveAssistantRawContent(ai = {}, contentText = "") {
  if (typeof ai?.content === "string" || Array.isArray(ai?.content)) return ai.content;
  return String(contentText || "");
}

function buildAssistantAdditionalKwargs(ai = {}) {
  const additionalKwargs = clonePlainObjectWithoutToolCalls(ai?.additional_kwargs) || {};
  if (isObjectLike(ai?.responseReasoning)) {
    additionalKwargs.reasoning = ai.responseReasoning;
  }
  return additionalKwargs;
}

function buildAssistantResponseMetadata(ai = {}) {
  const responseMetadata = clonePlainObjectWithoutToolCalls(ai?.response_metadata) || {};
  if (Array.isArray(ai?.responseOutput)) responseMetadata.output = ai.responseOutput;
  return responseMetadata;
}

export function buildAssistantModelMessageForToolCalls({
  ai = {},
  contentText = "",
  toolCalls = [],
  messageUid = "",
  modelMessageId = "",
} = {}) {
  const canonicalMessageUid = text(messageUid);
  const canonicalModelMessageId = text(modelMessageId);
  if (!canonicalMessageUid || !canonicalModelMessageId) {
    throw new TypeError("assistant model message requires messageUid and modelMessageId");
  }
  const message = new AIMessage({
    content: resolveAssistantRawContent(ai, contentText),
    tool_calls: formatToolCallsForLangChain(toolCalls),
    additional_kwargs: buildAssistantAdditionalKwargs(ai),
    response_metadata: buildAssistantResponseMetadata(ai),
  });
  return writeContextMessageMetadata(message, {
    messageUid: canonicalMessageUid,
    modelMessageId: canonicalModelMessageId,
  });
}
