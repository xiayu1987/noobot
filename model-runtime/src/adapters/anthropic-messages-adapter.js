/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { cacheControlValueForRuntime } from "../policies/cache-policy-engine.js";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { MODEL_OPERATION_KIND } from "@noobot/model-protocol";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_SERVER_WEB_SEARCH_TOOL = Object.freeze({
  type: "web_search_20250305",
  name: "web_search",
});
const ANTHROPIC_PAUSE_TURN_STOP_REASON = "pause_turn";
const ANTHROPIC_PAUSE_TURN_MAX_CONTINUATIONS = 3;
const ANTHROPIC_DOCUMENT_MIME_TYPE = "application/pdf";

function splitDataUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("data:")) return { mediaType: "", base64: raw };
  const separatorIndex = raw.indexOf(",");
  if (separatorIndex < 0) return { mediaType: "", base64: "" };
  const descriptor = raw.slice("data:".length, separatorIndex);
  return {
    mediaType: descriptor.split(";")[0].trim(),
    base64: raw.slice(separatorIndex + 1).trim(),
  };
}

function anthropicImageSource(url = "") {
  const raw = String(url || "").trim();
  if (!raw.startsWith("data:")) return { type: "url", url: raw };
  const { mediaType, base64 } = splitDataUrl(raw);
  return { type: "base64", media_type: mediaType, data: base64 };
}

function baseMessagesUrl(baseUrl = "") {
  let value = String(baseUrl || "");
  while (value.endsWith("/")) value = value.slice(0, -1);
  return /\/v1$/i.test(value) ? `${value}/messages` : `${value}/v1/messages`;
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function textBlocks(content) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (typeof block === "string") return block ? [{ type: "text", text: block }] : [];
    if (!block || typeof block !== "object") return [];
    if (block.type === "text") return [{ ...block, text: String(block.text || "") }];

    if (
      block.type === "thinking" ||
      block.type === "redacted_thinking" ||
      block.type === "tool_use" ||
      block.type === "tool_result" ||
      block.type === "server_tool_use" ||
      block.type === "server_tool_result"
    ) {
      return [{ ...block }];
    }
    if (block.type === "image_url" && block.image_url?.url) {
      return [{ type: "image", source: anthropicImageSource(block.image_url.url) }];
    }
    if (block.type === "image" && block.source) return [{ ...block }];
    if (block.type === "document" && block.source) return [{ ...block }];
    return [];
  });
}

function resolveMessageRole(message = {}) {
  const explicitRole = String(message?.role || "")
    .trim()
    .toLowerCase();
  if (explicitRole) return explicitRole;
  const type = String(message?.type || message?.lc_kwargs?.type || "")
    .trim()
    .toLowerCase();
  if (type === "human") return "user";
  if (type === "ai") return "assistant";
  return type;
}

function stringifyToolResultContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function convertMessages(messages = []) {
  const output = [];
  let pendingToolResults = [];
  const flushTools = () => {
    if (pendingToolResults.length) {
      output.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = resolveMessageRole(message);
    if (role === "system") continue;
    if (role === "tool") {
      pendingToolResults.push({
        type: "tool_result",
        tool_use_id: String(message.tool_call_id || message.tool_use_id || ""),
        content: stringifyToolResultContent(message.content),
      });
      continue;
    }
    flushTools();
    if (role === "assistant") {
      const content = textBlocks(message.content);
      const existingToolUseIds = new Set(
        content
          .filter((block) => block?.type === "tool_use")
          .map((block) => String(block.id || "")),
      );
      for (const call of message.tool_calls || []) {
        const fn = call?.function || call || {};
        const id = String(call.id || call.call_id || "");
        if (id && existingToolUseIds.has(id)) continue;
        content.push({
          type: "tool_use",
          id,
          name: String(fn.name || call.name || ""),
          input: parseJson(fn.arguments ?? call.args, {}),
        });
      }
      output.push({ role: "assistant", content: content.length ? content : "" });
      continue;
    }
    const content = textBlocks(message.content);
    output.push({ role: "user", content: content.length ? content : "" });
  }
  flushTools();
  return output;
}

function convertTools(tools = []) {
  return (Array.isArray(tools) ? tools : []).map((tool) => {
    const converted =
      tool && typeof tool === "object" && typeof tool.schema !== "undefined"
        ? convertToOpenAITool(tool)
        : tool;
    const fn = converted?.function || converted || {};
    return {
      name: String(fn.name || ""),
      description: String(fn.description || ""),
      input_schema: fn.parameters || fn.input_schema || { type: "object", properties: {} },
    };
  });
}

function convertToolChoice(value = "auto") {
  if (value && typeof value === "object") {
    const type = String(value.type || "auto");
    if (type === "function") {
      return { type: "tool", name: String(value.function?.name || value.name || "") };
    }
    return value;
  }
  const type = String(value || "auto").toLowerCase();
  if (type === "none") return { type: "none" };
  if (type === "required" || type === "any") return { type: "any" };
  return { type: "auto" };
}

function responseFromAnthropic(raw = {}) {
  const blocks = Array.isArray(raw.content) ? raw.content : [];

  const reasoning = blocks
    .filter((b) => b?.type === "thinking")
    .map((b) => b.thinking || "")
    .join("\n");
  const tool_calls = blocks
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  const usage = raw.usage || {};
  return {
    content: blocks.map((block) => ({ ...block })),
    reasoning_content: reasoning,
    tool_calls,
    response_metadata: {
      finish_reason: raw.stop_reason || "",
      tokenUsage: usage,
      raw,
    },
    usage_metadata: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    },
  };
}

function createClient({ modelSpec, credential, headers = {}, tools = [], toolChoice = "auto" }) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  const client = {
    async invoke(messages, invokeOptions = {}) {
      const system = (Array.isArray(messages) ? messages : [])
        .filter((message) => resolveMessageRole(message) === "system")
        .flatMap((message) => textBlocks(message.content));
      const payload = {
        model: spec.model,
        max_tokens: Number(spec.max_tokens || 10000),
        ...((!spec.reasoning_effort || spec.reasoning_effort === "none") &&
        spec.temperature !== undefined
          ? { temperature: spec.temperature }
          : {}),
        ...(tools.length
          ? { tools: convertTools(tools), tool_choice: convertToolChoice(toolChoice) }
          : {}),
        ...(spec.reasoning_effort && spec.reasoning_effort !== "none"
          ? { thinking: { type: "adaptive" }, output_config: { effort: spec.reasoning_effort } }
          : {}),
        ...(cacheControlValueForRuntime(spec)
          ? { cache_control: cacheControlValueForRuntime(spec) }
          : {}),
        ...(system.length ? { system } : {}),
        messages: convertMessages(messages),
      };
      return responseFromAnthropic(
        await requestAnthropicMessages({
          spec,
          credential,
          headers,
          payload,
          signal: invokeOptions.signal,
        }),
      );
    },
  };
  client.__modelSpec = modelSpec;
  client.__credential = credential;
  client.__headers = headers;
  return client;
}

async function requestAnthropicMessages({ spec, credential, headers = {}, payload, signal }) {
  const response = await fetch(baseMessagesUrl(spec.base_url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": ANTHROPIC_VERSION,
      "x-api-key": credential,
      ...headers,
    },
    body: JSON.stringify(payload),
    signal: signal || undefined,
  });
  const body = await response.text();
  const parsed = parseJson(body, { error: { message: body } });
  if (!response.ok) {
    const error = new Error(parsed?.error?.message || `Anthropic API returned ${response.status}`);
    error.status = response.status;
    error.response = parsed;
    throw error;
  }
  return parsed;
}

function resultFromAnthropicBlocks(parsed = {}) {
  const blocks = Array.isArray(parsed?.content) ? parsed.content : [];
  return {
    rawText: blocks
      .filter((block) => block?.type === "text")
      .map((block) => String(block.text || ""))
      .join("")
      .trim(),
    output: blocks.map((block) => ({ ...block })),
  };
}

export function mapAnthropicMultimodalAttachment(attachment = {}) {
  const mimeType = String(attachment.mimeType || "").trim();
  const normalizedMimeType = mimeType.toLowerCase();
  const { mediaType, base64 } = splitDataUrl(attachment.data);
  const resolvedMediaType = mediaType || normalizedMimeType;
  if (normalizedMimeType.startsWith("image/")) {
    return {
      type: "image",
      source: { type: "base64", media_type: resolvedMediaType, data: base64 },
    };
  }
  if (normalizedMimeType === ANTHROPIC_DOCUMENT_MIME_TYPE) {
    return {
      type: "document",
      source: { type: "base64", media_type: ANTHROPIC_DOCUMENT_MIME_TYPE, data: base64 },
    };
  }
  throw new TypeError(
    `provider adapter anthropic-messages does not support attachment mime type: ${mimeType || "missing"}`,
  );
}

async function executeAnthropicServerToolTurn({
  spec,
  credential,
  headers,
  signal,
  serverTools,
  content,
}) {
  const messages = [{ role: "user", content }];
  const collected = [];
  for (let attempt = 0; attempt <= ANTHROPIC_PAUSE_TURN_MAX_CONTINUATIONS; attempt += 1) {
    const parsed = await requestAnthropicMessages({
      spec,
      credential,
      headers,
      signal,
      payload: {
        model: spec.model,
        max_tokens: Number(spec.max_tokens || 10000),
        tools: serverTools,
        messages,
      },
    });
    const turnBlocks = Array.isArray(parsed?.content) ? parsed.content : [];
    collected.push(...turnBlocks.map((block) => ({ ...block })));
    if (parsed?.stop_reason !== ANTHROPIC_PAUSE_TURN_STOP_REASON) break;
    messages.push({ role: "assistant", content: turnBlocks.map((block) => ({ ...block })) });
  }
  return resultFromAnthropicBlocks({ content: collected });
}

async function executeAnthropicOperation({
  modelSpec,
  credential,
  operation,
  headers = {},
  signal,
  mapMultimodalAttachment = mapAnthropicMultimodalAttachment,
}) {
  if (
    operation.kind !== MODEL_OPERATION_KIND.WEB_SEARCH &&
    operation.kind !== MODEL_OPERATION_KIND.MULTIMODAL_PARSE
  ) {
    throw new TypeError(
      `provider adapter anthropic-messages does not support operation: ${operation.kind}`,
    );
  }
  const spec = normalizeRuntimeModelSpec(modelSpec);
  if (operation.kind === MODEL_OPERATION_KIND.WEB_SEARCH) {
    return executeAnthropicServerToolTurn({
      spec,
      credential,
      headers,
      signal,
      serverTools: [ANTHROPIC_SERVER_WEB_SEARCH_TOOL],
      content: [{ type: "text", text: String(operation.input.query || "").trim() }],
    });
  }
  const parsed = await requestAnthropicMessages({
    spec,
    credential,
    headers,
    signal,
    payload: {
      model: spec.model,
      max_tokens: Number(spec.max_tokens || 10000),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: String(operation.input.prompt || "").trim() },
            ...operation.input.attachments.map(mapMultimodalAttachment),
          ],
        },
      ],
    },
  });
  return resultFromAnthropicBlocks(parsed);
}

export const anthropicMessagesAdapter = Object.freeze({
  id: "anthropic-messages",
  classifyError: classifyTransportError,
  createClient(input) {
    return createClient(input);
  },
  bindTools({ client, tools, toolOptions = {} }) {
    return createClient({
      modelSpec: client.__modelSpec,
      credential: client.__credential,
      headers: client.__headers,
      tools,
      toolChoice: toolOptions.tool_choice || "auto",
    });
  },
  prepareMessages({ messages }) {
    return messages;
  },
  executeOperation(input) {
    return executeAnthropicOperation(input);
  },
});

export { convertMessages, convertToolChoice, convertTools, responseFromAnthropic };
