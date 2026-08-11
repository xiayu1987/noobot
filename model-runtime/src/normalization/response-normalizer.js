/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const THINK = /<think>[\s\S]*?<\/think>/gi;
const CAPTURE = /<think>([\s\S]*?)<\/think>/gi;

function text(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value
      .map((item) => (typeof item === "string" ? item : item?.text || item?.content || ""))
      .filter(Boolean)
      .join("\n");
  return value?.text || value?.content || "";
}

export function extractResponseText(response = {}) {
  return String(text(response.content) || response.text || response.output || "")
    .replace(THINK, "")
    .trim();
}

export function extractReasoningText(response = {}) {
  for (const value of [
    response.reasoning_content,
    response.reasoningContent,
    response.additional_kwargs?.reasoning_content,
    response.additional_kwargs?.reasoningContent,
    response.response_metadata?.reasoning_content,
    response.response_metadata?.reasoningContent,
    response.raw?.choices?.[0]?.message?.reasoning_content,
  ]) {
    const output = text(value);
    if (output) return output;
  }
  const raw = text(response.content) || response.text || response.output || "";
  const chunks = [];
  let match;
  const expression = new RegExp(CAPTURE);
  while ((match = expression.exec(raw)))
    if (String(match[1] || "").trim()) chunks.push(String(match[1]).trim());
  return chunks.join("\n");
}

export function resolveFinishReason(response = {}) {
  for (const value of [
    response.response_metadata?.finish_reason,
    response.response_metadata?.finishReason,
    response.additional_kwargs?.finish_reason,
    response.finish_reason,
    response.finishReason,
  ]) {
    const output = String(value || "")
      .trim()
      .toLowerCase();
    if (output) return output;
  }
  return "";
}

export function normalizeToolCalls(response = {}) {
  const calls =
    response.tool_calls ||
    response.additional_kwargs?.tool_calls ||
    response.raw?.choices?.[0]?.message?.tool_calls;
  return Array.isArray(calls)
    ? calls.map((call) => ({
        id: String(call.id || call.call_id || ""),
        name: String(call.name || call.function?.name || ""),
        args: call.args ?? call.function?.arguments ?? {},
      }))
    : [];
}

export function normalizeModelOutput(response = {}) {
  return Object.freeze({
    text: extractResponseText(response),
    reasoning: extractReasoningText(response),
    toolCalls: normalizeToolCalls(response),
    finishReason: resolveFinishReason(response),
    usage: Object.freeze({
      ...(response.usage_metadata || response.response_metadata?.tokenUsage || {}),
    }),
  });
}
