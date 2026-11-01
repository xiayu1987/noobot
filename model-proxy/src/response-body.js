/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import zlib from "node:zlib";
import util from "node:util";
import { parseServerSentEvents } from "@noobot/shared/event-stream";
import { tryParseJson } from "./common.js";
import { text, isObjectLike } from "@noobot/shared/value";

const gunzip = util.promisify(zlib.gunzip);
const inflate = util.promisify(zlib.inflate);
const brotliDecompress = util.promisify(zlib.brotliDecompress);

async function decodeBodyByEncoding(buffer, encoding) {
  if (!encoding) return buffer;
  const encodings = String(encoding)
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  for (const enc of encodings.reverse()) {
    if (enc === "identity") continue;
    const decode = { gzip: gunzip, deflate: inflate, br: brotliDecompress }[enc];
    if (typeof decode !== "function") throw new TypeError(`unsupported content encoding: ${enc}`);
    buffer = await decode(buffer);
  }
  return buffer;
}

function normalizeBodyText(inputText, contentType = "") {
  const ct = String(contentType).toLowerCase();

  if (ct.includes("application/json")) return JSON.stringify(JSON.parse(inputText), null, 2);

  return inputText;
}

function normalizeToolCallItem(toolCallItem = {}) {
  if (!isObjectLike(toolCallItem)) return null;
  const normalizedFunction =
    toolCallItem.function && typeof toolCallItem.function === "object"
      ? {
          name: text(toolCallItem.function.name),
          arguments: String(toolCallItem.function.arguments || ""),
        }
      : {};
  const normalized = {
    id: text(toolCallItem.id),
    type: text(toolCallItem.type) || "function",
    function: normalizedFunction,
  };
  if (!normalized.id && !normalized.function?.name && !normalized.function?.arguments) return null;
  return normalized;
}

function extractToolCallsFromJsonPayload(payloadObject = null) {
  if (!isObjectLike(payloadObject)) return [];
  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] : null;
  const messageToolCalls = Array.isArray(firstChoice?.message?.tool_calls)
    ? firstChoice.message.tool_calls
    : [];
  if (messageToolCalls.length) {
    return messageToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
    ? firstChoice.delta.tool_calls
    : [];
  if (deltaToolCalls.length) {
    return deltaToolCalls.map((item) => normalizeToolCallItem(item)).filter(Boolean);
  }
  return [];
}

function normalizeResponsesOutputItem(item = {}) {
  if (!isObjectLike(item)) return null;
  if (item.type === "function_call") {
    return {
      id: text(item.call_id || item.id),
      type: "function",
      function: {
        name: text(item.name),
        arguments: String(item.arguments || "{}"),
      },
    };
  }
  return null;
}

function extractResponsesOutput(payloadObject = null) {
  if (!Array.isArray(payloadObject?.output)) return { text: "", toolCalls: [], reasoning: [] };
  const textValue = [];
  const toolCalls = [];
  const reasoning = [];
  for (const item of payloadObject.output) {
    if (!isObjectLike(item)) continue;
    if (item.type === "function_call") {
      toolCalls.push(normalizeResponsesOutputItem(item));
      continue;
    }
    if (item.type === "reasoning") {
      const summaries = Array.isArray(item.summary) ? item.summary : [];
      reasoning.push(
        ...summaries
          .map((summary) => text(typeof summary === "string" ? summary : summary?.text))
          .filter(Boolean),
      );
      continue;
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    textValue.push(...extractMessageTextBlocks(item.content));
  }
  return { text: textValue.join(""), toolCalls, reasoning };
}

function extractMessageTextBlocks(content) {
  return content
    .filter((block) => block?.type === "output_text" || block?.type === "text")
    .map((block) => text(block.text))
    .filter(Boolean);
}

function extractAnthropicContent(payloadObject = null) {
  if (!Array.isArray(payloadObject?.content)) return { text: "", toolCalls: [], reasoning: [] };
  const rawText = [];
  const toolCalls = [];
  const reasoning = [];
  for (const block of payloadObject.content) {
    if (block?.type === "text" && text(block.text)) rawText.push(String(block.text).trim());
    if (block?.type === "thinking" && text(block.thinking))
      reasoning.push(String(block.thinking).trim());
    if (block?.type === "tool_use") {
      toolCalls.push({
        id: text(block.id),
        type: "function",
        function: {
          name: text(block.name),
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  return { text: rawText.join(""), toolCalls, reasoning };
}

function formatResponseProjection({ text: sourceText = "", toolCalls = [], reasoning = [] } = {}) {
  if (text(sourceText)) return String(sourceText).trim();
  if (toolCalls.length) {
    return JSON.stringify({ type: "tool_calls", tool_calls: toolCalls }, null, 2);
  }
  if (reasoning.length) {
    return JSON.stringify({ type: "reasoning", summary: reasoning }, null, 2);
  }
  return "";
}

function extractFinalTextFromJsonPayload(payloadObject = null) {
  if (!isObjectLike(payloadObject)) return "";

  const choices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object" ? choices[0] : null;
  const messageContent = text(firstChoice?.message?.content);
  if (messageContent) return messageContent;

  const deltaContent = text(firstChoice?.delta?.content);
  if (deltaContent) return deltaContent;

  const outputText = payloadObject?.output_text;
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim();
  if (Array.isArray(outputText)) {
    const joinedOutputText = outputText
      .map((itemValue) => text(itemValue))
      .filter(Boolean)
      .join("\n");
    if (joinedOutputText) return joinedOutputText;
  }

  const toolCalls = extractToolCallsFromJsonPayload(payloadObject);
  if (toolCalls.length) {
    return JSON.stringify(
      {
        type: "tool_calls",
        tool_calls: toolCalls,
      },
      null,
      2,
    );
  }

  return "";
}

function extractFinalTextFromSseBody(sseText = "") {
  const dataPayloads = parseServerSentEvents(sseText)
    .map(({ data }) => data.trim())
    .filter((payloadText) => payloadText && payloadText !== "[DONE]");

  if (!dataPayloads.length) return "";

  let deltaTextBuffer = "";
  let latestResolvedText = "";
  const toolCallBufferByIndex = new Map();

  function upsertToolCallDelta(deltaToolCallItem = {}, fallbackIndex = 0) {
    if (!isObjectLike(deltaToolCallItem)) return;
    const index = Number.isInteger(deltaToolCallItem.index)
      ? deltaToolCallItem.index
      : fallbackIndex;
    const existed = toolCallBufferByIndex.get(index) || {
      id: "",
      type: "function",
      function: { name: "", arguments: "" },
    };
    const normalizedType = text(deltaToolCallItem.type);
    if (normalizedType) existed.type = normalizedType;
    const normalizedId = text(deltaToolCallItem.id);
    if (normalizedId) existed.id = normalizedId;

    const fn =
      deltaToolCallItem.function && typeof deltaToolCallItem.function === "object"
        ? deltaToolCallItem.function
        : null;
    if (fn) {
      const namePart = String(fn.name || "");
      if (namePart) existed.function.name = `${existed.function.name || ""}${namePart}`;
      const argsPart = String(fn.arguments || "");
      if (argsPart) existed.function.arguments = `${existed.function.arguments || ""}${argsPart}`;
    }
    toolCallBufferByIndex.set(index, existed);
  }

  for (const payloadText of dataPayloads) {
    const payloadObject = tryParseJson(payloadText);
    if (!payloadObject) {
      latestResolvedText = payloadText;
      continue;
    }
    const payloadChoices = Array.isArray(payloadObject?.choices) ? payloadObject.choices : [];
    const firstChoice =
      payloadChoices[0] && typeof payloadChoices[0] === "object" ? payloadChoices[0] : null;
    const deltaToolCalls = Array.isArray(firstChoice?.delta?.tool_calls)
      ? firstChoice.delta.tool_calls
      : [];
    deltaToolCalls.forEach((item, idx) => upsertToolCallDelta(item, idx));
    if (
      deltaToolCalls.length &&
      !text(firstChoice?.delta?.content) &&
      !text(firstChoice?.message?.content)
    )
      continue;
    const payloadResolvedText = extractFinalTextFromJsonPayload(payloadObject);
    if (!payloadResolvedText) continue;
    const hasDeltaContent = typeof firstChoice?.delta?.content === "string";
    if (hasDeltaContent) {
      deltaTextBuffer += String(firstChoice?.delta?.content || "");
      latestResolvedText = deltaTextBuffer;
    } else {
      latestResolvedText = payloadResolvedText;
    }
  }

  return (
    projectSseToolCalls(toolCallBufferByIndex, latestResolvedText) ||
    latestResolvedText ||
    dataPayloads[dataPayloads.length - 1]
  );
}

function projectSseToolCalls(toolCallBufferByIndex, latestResolvedText) {
  if (!toolCallBufferByIndex.size || text(latestResolvedText)) return "";
  const toolCalls = Array.from(toolCallBufferByIndex.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, item]) => normalizeToolCallItem(item))
    .filter(Boolean);
  if (!toolCalls.length) return "";
  return JSON.stringify(
    {
      type: "tool_calls",
      tool_calls: toolCalls,
    },
    null,
    2,
  );
}

function resolveFinalResponseBodyText(bodyText = "", contentType = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();
  const normalizedBodyText = String(bodyText || "");

  if (normalizedContentType.includes("text/event-stream")) {
    const finalSseText = extractFinalTextFromSseBody(normalizedBodyText);
    return finalSseText || normalizedBodyText;
  }

  if (normalizedContentType.includes("application/json")) {
    const payloadObject = tryParseJson(normalizedBodyText);
    const finalJsonText = extractFinalTextFromJsonPayload(payloadObject);
    if (finalJsonText) return finalJsonText;
    const responsesProjection = formatResponseProjection(extractResponsesOutput(payloadObject));
    if (responsesProjection) return responsesProjection;
    const anthropicProjection = formatResponseProjection(extractAnthropicContent(payloadObject));
    if (anthropicProjection) return anthropicProjection;
    return normalizeBodyText(normalizedBodyText, contentType);
  }

  return normalizedBodyText;
}

export {
  decodeBodyByEncoding,
  extractAnthropicContent,
  extractResponsesOutput,
  resolveFinalResponseBodyText,
};
