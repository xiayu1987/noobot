/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { cacheControlValueForRuntime } from "../policies/cache-policy-engine.js";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

function baseMessagesUrl(baseUrl = "") {
  const value = String(baseUrl || "").replace(/\/+$/, "");
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
    if (block.type === "text") return [{ type: "text", text: String(block.text || "") }];
    if (block.type === "image_url" && block.image_url?.url) {
      return [{ type: "image", source: { type: "url", url: block.image_url.url } }];
    }
    return [];
  });
}

function resolveMessageRole(message = {}) {
  const explicitRole = String(message?.role || "").trim().toLowerCase();
  if (explicitRole) return explicitRole;
  const type = String(
    (typeof message?._getType === "function" ? message._getType() : "") ||
      message?.type ||
      message?.lc_kwargs?.type ||
      "",
  )
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
      for (const call of message.tool_calls || []) {
        const fn = call?.function || call || {};
        content.push({
          type: "tool_use",
          id: String(call.id || call.call_id || ""),
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
  const text = blocks.filter((b) => b?.type === "text").map((b) => b.text || "").join("");
  const reasoning = blocks.filter((b) => b?.type === "thinking").map((b) => b.thinking || "").join("\n");
  const tool_calls = blocks.filter((b) => b?.type === "tool_use").map((b) => ({
    id: b.id,
    type: "function",
    function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
  }));
  const usage = raw.usage || {};
  return {
    content: text,
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
        ...(!spec.reasoning_effort || spec.reasoning_effort === "none") &&
        spec.temperature !== undefined
          ? { temperature: spec.temperature }
          : {},
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
      const response = await fetch(baseMessagesUrl(spec.base_url), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": credential,
          ...headers,
        },
        body: JSON.stringify(payload),
        signal: invokeOptions.signal,
      });
      const body = await response.text();
      const parsed = parseJson(body, { error: { message: body } });
      if (!response.ok) {
        const error = new Error(parsed?.error?.message || `Anthropic API returned ${response.status}`);
        error.status = response.status;
        error.response = parsed;
        throw error;
      }
      return responseFromAnthropic(parsed);
    },
  };
  client.__modelSpec = modelSpec;
  client.__credential = credential;
  client.__headers = headers;
  return client;
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
});

export { convertMessages, convertToolChoice, convertTools, responseFromAnthropic };
