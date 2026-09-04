/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { buildModelReasoningEffortTransport } from "@noobot/model-protocol";

const PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "google",
  "gemini",
  "deepseek",
  "alibaba",
  "zhipu",
  "kimi",
  "xai",
  "generic",
]);

function operatorId(spec = {}) {
  const value = String(spec.operatorId || "")
    .trim()
    .toLowerCase();
  if (!value) throw new TypeError("model spec.operatorId is required");
  if (!PROVIDER_IDS.has(value)) throw new TypeError(`unsupported model operatorId: ${value}`);
  return value;
}

function modelFamily(spec = {}) {
  const value = String(spec.modelFamily || "")
    .trim()
    .toLowerCase();
  if (!value) throw new TypeError("model spec.modelFamily is required");
  return value;
}

/**
 * GPT and Claude expose a body-level prompt-cache identity in the transports
 * used by this adapter. Other providers have different protocols (or only
 * server-managed prefix caching), so their cache identity must not leak into
 * OpenAI `prompt_cache_*` fields.
 */
function usesPromptCacheKeyProtocol(spec = {}) {
  const family = modelFamily(spec);
  return family === "gpt" || family === "claude";
}

function segment(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = normalized.length;
  while (normalized[start] === "-") start += 1;
  while (end > start && normalized[end - 1] === "-") end -= 1;
  return normalized.slice(start, end);
}

export function resolveCacheVendor(spec = {}) {
  return operatorId(spec);
}

/** Grok carries its cache identity in a request header rather than the body. */
export function resolvePromptCacheHeaders(spec = {}, flow = "agent.main") {
  if (modelFamily(spec) !== "grok") return {};
  const key =
    String(spec.prompt_cache_key ?? spec.promptCacheKey ?? "").trim() ||
    buildCacheIdentity(spec, flow);
  return key ? { "x-grok-conv-id": key } : {};
}

function cacheControlValue(spec = {}) {
  const value = spec.cache_control ?? spec.prompt_cache_control ?? spec.promptCacheControl;
  if (value === false) return null;
  return value && typeof value === "object"
    ? { type: value.type || "ephemeral", ...(value.ttl === "1h" ? { ttl: "1h" } : {}) }
    : { type: "ephemeral" };
}

/**
 * Apply message-level cache markers required by DashScope/Qwen. Claude uses
 * Anthropic's top-level automatic cache control and is compiled below.
 */
export function applyPromptCacheMessages(spec = {}, messages = []) {
  const family = modelFamily(spec);
  if (family !== "qwen") return messages;
  const marker = cacheControlValue(spec);
  if (!marker) return messages;
  const source = Array.isArray(messages) ? messages : [];
  const index = source.findIndex(
    (message) => String(message?.role || "").toLowerCase() === "system",
  );
  if (index < 0) return source;
  const message = source[index] || {};
  const content = message.content;
  if (Array.isArray(content)) {
    const blocks = content.map((block) =>
      block && typeof block === "object" ? { ...block } : block,
    );
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (
        blocks[i] &&
        typeof blocks[i] === "object" &&
        String(blocks[i].type || "text") === "text"
      ) {
        blocks[i] = { ...blocks[i], cache_control: marker };
        return source.map((item, itemIndex) =>
          itemIndex === index ? { ...message, content: blocks } : item,
        );
      }
    }
    return source;
  }
  if (typeof content === "string" && content) {
    return source.map((item, itemIndex) =>
      itemIndex === index
        ? { ...message, content: [{ type: "text", text: content, cache_control: marker }] }
        : item,
    );
  }
  return source;
}

/** The flow-scoped cache identity, independent of how a provider carries it. */
function buildCacheIdentity(spec = {}, flow = "agent.main") {
  const model = segment(spec.model);
  if (!model) return "";
  const normalizedFlow = segment(flow);
  return (
    normalizedFlow && normalizedFlow !== "agent-main"
      ? `noobot-${normalizedFlow}-${model}`
      : `noobot-main-${model}`
  ).slice(0, 200);
}

export function buildPromptCacheKey(spec = {}, flow = "agent.main") {
  return usesPromptCacheKeyProtocol(spec) ? buildCacheIdentity(spec, flow) : "";
}

function gptVersion(name = "") {
  const match = String(name)
    .toLowerCase()
    .match(/\bgpt[-_]?(\d+)(?:\.(\d+))?(?:\b|[-_])/);
  return match ? { major: Number(match[1]), minor: Number(match[2] || 0) } : null;
}

export function compileProviderModelKwargs(spec = {}, flow = "agent.main") {
  const vendor = operatorId(spec);
  const out = { ...(spec.extra_body || {}) };
  for (const key of [
    "prompt_cache_key",
    "prompt_cache_retention",
    "prompt_cache_options",
    "cache_control",
    "cached_content",
    "cachedContent",
  ])
    delete out[key];

  if (usesPromptCacheKeyProtocol(spec)) {
    const key =
      String(spec.prompt_cache_key ?? spec.promptCacheKey ?? "").trim() ||
      buildCacheIdentity(spec, flow);
    if (key) out.prompt_cache_key = key;
    const version = gptVersion(spec.model);
    if (version?.major === 5 && version.minor >= 6) {
      out.prompt_cache_options = spec.prompt_cache_options ||
        spec.promptCacheOptions || { ttl: "30m" };
    } else {
      out.prompt_cache_retention = String(
        spec.prompt_cache_retention || spec.promptCacheRetention || "24h",
      );
    }
  }

  if (modelFamily(spec) === "claude") {
    const marker = cacheControlValue(spec);
    if (marker) out.cache_control = marker;
  }

  if (modelFamily(spec) === "gemini" || vendor === "google" || vendor === "gemini") {
    const value = String(
      spec.cached_content ?? spec.cachedContent ?? spec.gemini_cached_content ?? "",
    ).trim();
    if (value) out.cached_content = value;
  }

  if (spec.reasoning_effort !== undefined) {
    Object.assign(out, buildModelReasoningEffortTransport(spec, spec.reasoning_effort));
  }
  for (const key of ["frequency_penalty", "presence_penalty"]) {
    if (spec[key] !== undefined) out[key] = spec[key];
  }
  if (
    spec.top_p !== undefined &&
    !(modelFamily(spec) === "gpt" && String(spec.model).toLowerCase().includes("gpt-5"))
  ) {
    out.top_p = spec.top_p;
  }
  return out;
}
