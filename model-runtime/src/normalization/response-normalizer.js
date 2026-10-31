/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import { validateModelToolCall } from "@noobot/model-protocol";

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

function splitThinkContent(value = "") {
  const source = String(value || "");
  const searchable = source.toLowerCase();
  const visible = [];
  const reasoning = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = searchable.indexOf(THINK_OPEN, cursor);
    if (open < 0) {
      visible.push(source.slice(cursor));
      break;
    }
    visible.push(source.slice(cursor, open));
    const contentStart = open + THINK_OPEN.length;
    const close = searchable.indexOf(THINK_CLOSE, contentStart);
    if (close < 0) {
      visible.push(source.slice(open));
      break;
    }
    const content = source.slice(contentStart, close).trim();
    if (content) reasoning.push(content);
    cursor = close + THINK_CLOSE.length;
  }
  return { visible: visible.join(""), reasoning };
}

function extractContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
}

export function extractResponseText(response) {
  return splitThinkContent(extractContentText(response.content)).visible.trim();
}

export function extractReasoningText(response) {
  const reasoning = text(response.additional_kwargs?.reasoning_content);
  if (reasoning) return reasoning;
  return splitThinkContent(extractContentText(response.content)).reasoning.join("\n");
}

export function resolveFinishReason(response) {
  return text(response.response_metadata?.finish_reason).toLowerCase();
}

function rawToolCalls(response) {
  return [
    ...(Array.isArray(response.tool_calls) ? response.tool_calls : []),
    ...(Array.isArray(response.invalid_tool_calls) ? response.invalid_tool_calls : []),
  ];
}

export function classifyToolCalls(response) {
  const toolCalls = [];
  const invalidToolCalls = [];
  rawToolCalls(response).forEach((call, index) => {
    const projected = { id: text(call?.id), name: text(call?.name), args: call?.args };
    try {
      toolCalls.push(validateModelToolCall(projected, `model tool call[${index}]`));
    } catch (error) {
      invalidToolCalls.push({
        index,
        id: projected.id,
        name: projected.name,
        reason: String(error?.message || error),
      });
    }
  });
  return { toolCalls, invalidToolCalls };
}

export function normalizeModelOutput(response) {
  return normalizeModelResponse(response).output;
}

export function normalizeModelResponse(response) {
  const { toolCalls, invalidToolCalls } = classifyToolCalls(response);
  const responseOutput = Array.isArray(response.response_metadata?.output)
    ? response.response_metadata.output
    : null;
  const responseReasoning = isPlainObject(response.additional_kwargs?.reasoning)
    ? response.additional_kwargs.reasoning
    : null;
  return Object.freeze({
    output: Object.freeze({
      ...(typeof response.content === "string" || Array.isArray(response.content)
        ? { content: response.content }
        : {}),
      ...(responseOutput ? { responseOutput } : {}),
      ...(responseReasoning ? { responseReasoning } : {}),
      text: extractResponseText(response),
      reasoning: extractReasoningText(response),
      toolCalls,
      finishReason: resolveFinishReason(response),
      usage: Object.freeze({ ...response.usage_metadata }),
    }),
    invalidToolCalls: Object.freeze(invalidToolCalls),
  });
}
