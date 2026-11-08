/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
import {
  MODEL_RESPONSE_SOURCE,
  ModelProtocolError,
  requireModelResponseSource,
  validateModelToolCall,
} from "@noobot/model-protocol";

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

function projectResponsesToolCalls(item) {
  if (item.type === "function_call") {
    return [{ id: item.call_id, name: item.name, arguments: item.arguments }];
  }
  if (item.type === "custom_tool_call") {
    return [{ id: item.call_id, name: item.name, args: { input: item.input } }];
  }
  if (item.type === "computer_call") {
    return [{ id: item.call_id, name: "computer_use", args: { action: item.action } }];
  }
  return [];
}

function projectResponsesTerminal(response) {
  const metadata = response.response_metadata;
  const status = text(metadata?.status);
  const finishReason = status === "incomplete" ? text(metadata.incomplete_details?.reason) : status;
  if (!Array.isArray(metadata?.output) || !finishReason) {
    throw new ModelProtocolError(
      "Responses API result requires terminal output and finish reason",
      {
        details: { hasOutput: Array.isArray(metadata?.output), status },
      },
    );
  }
  return {
    rawCalls: metadata.output.flatMap(projectResponsesToolCalls),
    finishReason: finishReason.toLowerCase(),
    responseOutput: metadata.output,
  };
}

function projectMessageTerminal(response) {
  return {
    rawCalls: [
      ...(Array.isArray(response.tool_calls) ? response.tool_calls : []),
      ...(Array.isArray(response.invalid_tool_calls) ? response.invalid_tool_calls : []),
    ],
    finishReason: text(response.response_metadata?.finish_reason).toLowerCase(),
    responseOutput: null,
  };
}

function projectTerminal(response, source) {
  return requireModelResponseSource(source) === MODEL_RESPONSE_SOURCE.RESPONSES
    ? projectResponsesTerminal(response)
    : projectMessageTerminal(response);
}

function classifyRawToolCalls(rawCalls) {
  const toolCalls = [];
  const invalidToolCalls = [];
  rawCalls.forEach((call, index) => {
    const projected = { id: text(call?.id), name: text(call?.name), args: call?.args };
    try {
      if (Object.hasOwn(call, "arguments")) projected.args = JSON.parse(call.arguments);
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

export function classifyToolCalls(response, source) {
  return classifyRawToolCalls(projectTerminal(response, source).rawCalls);
}

export function normalizeModelOutput(response, source) {
  return normalizeModelResponse(response, source).output;
}

export function normalizeModelResponse(response, source) {
  const { rawCalls, finishReason, responseOutput } = projectTerminal(response, source);
  const { toolCalls, invalidToolCalls } = classifyRawToolCalls(rawCalls);
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
      finishReason,
    }),
    invalidToolCalls: Object.freeze(invalidToolCalls),
  });
}
