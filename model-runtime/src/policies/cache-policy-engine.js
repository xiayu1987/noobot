/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  MODEL_FAMILY_ID,
  MODEL_PROMPT_CACHE_FIELD,
  MODEL_PROVIDER_ID,
  buildModelReasoningEffortTransport,
  normalizeModelPromptCacheFields,
  requireModelFamilyId,
  resolveModelFamilyPromptCacheFields,
  resolveModelPromptCacheValue,
} from "@noobot/model-protocol";

const PROVIDER_IDS = new Set(Object.values(MODEL_PROVIDER_ID));

function operatorId(spec = {}) {
  const value = String(spec.operatorId || "")
    .trim()
    .toLowerCase();
  if (!value) throw new TypeError("model spec.operatorId is required");
  if (!PROVIDER_IDS.has(value)) throw new TypeError(`unsupported model operatorId: ${value}`);
  return value;
}

function modelFamily(spec = {}) {
  return requireModelFamilyId(spec.modelFamily);
}

function selectedCacheFields(spec = {}) {
  const selected = normalizeModelPromptCacheFields(spec.prompt_cache_fields);
  const supported = new Set(resolveModelFamilyPromptCacheFields(spec));
  for (const field of selected) {
    if (!supported.has(field)) {
      throw new TypeError(
        `model spec.prompt_cache_fields value ${field} is outside the model-family cache protocol for ${spec.model}`,
      );
    }
  }
  return selected;
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

export function resolvePromptCacheHeaders(
  spec = {},
  flow = "agent.main",
  { useResponsesApi = false } = {},
) {
  if (modelFamily(spec) !== MODEL_FAMILY_ID.GROK) return {};
  if (useResponsesApi) return {};
  if (!selectedCacheFields(spec).includes(MODEL_PROMPT_CACHE_FIELD.KEY)) return {};
  const key = buildCacheIdentity(spec, flow);
  return key ? { "x-grok-conv-id": key } : {};
}

function cacheControlValue(spec = {}) {
  const fields = selectedCacheFields(spec);
  return fields.includes(MODEL_PROMPT_CACHE_FIELD.CACHE_CONTROL)
    ? resolveModelPromptCacheValue(spec, MODEL_PROMPT_CACHE_FIELD.CACHE_CONTROL)
    : null;
}

export function cacheControlValueForRuntime(spec = {}) {
  return cacheControlValue(spec);
}

export function applyPromptCacheMessages(spec = {}, messages = []) {
  const family = modelFamily(spec);
  if (family !== MODEL_FAMILY_ID.QWEN) return messages;
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

export function compileProviderModelKwargs(
  spec = {},
  flow = "agent.main",
  { useResponsesApi = false } = {},
) {
  const vendor = operatorId(spec);
  const out = { ...(spec.extra_body || {}) };
  for (const key of [
    "prompt_cache_key",
    "prompt_cache_retention",
    "prompt_cache_options",
    "cache_control",
    "cached_content",
  ])
    delete out[key];

  const cacheFields = selectedCacheFields(spec);
  if (
    cacheFields.includes(MODEL_PROMPT_CACHE_FIELD.KEY) &&
    (modelFamily(spec) !== MODEL_FAMILY_ID.GROK || useResponsesApi)
  ) {
    const key = buildCacheIdentity(spec, flow);
    if (key) out.prompt_cache_key = key;
  }
  if (cacheFields.includes(MODEL_PROMPT_CACHE_FIELD.OPTIONS))
    out.prompt_cache_options = resolveModelPromptCacheValue(spec, MODEL_PROMPT_CACHE_FIELD.OPTIONS);
  if (cacheFields.includes(MODEL_PROMPT_CACHE_FIELD.RETENTION))
    out.prompt_cache_retention = resolveModelPromptCacheValue(
      spec,
      MODEL_PROMPT_CACHE_FIELD.RETENTION,
    );
  if (
    cacheFields.includes(MODEL_PROMPT_CACHE_FIELD.CACHE_CONTROL) &&
    modelFamily(spec) !== MODEL_FAMILY_ID.QWEN
  )
    out.cache_control = resolveModelPromptCacheValue(spec, MODEL_PROMPT_CACHE_FIELD.CACHE_CONTROL);

  if (
    modelFamily(spec) === MODEL_FAMILY_ID.GEMINI ||
    vendor === MODEL_PROVIDER_ID.GOOGLE ||
    vendor === MODEL_PROVIDER_ID.GEMINI
  ) {
    const value = String(spec.cached_content ?? "").trim();
    if (value) out.cached_content = value;
  }

  if (spec.reasoning_effort !== undefined) {
    Object.assign(out, buildModelReasoningEffortTransport(spec, spec.reasoning_effort));
  }
  for (const key of ["frequency_penalty", "presence_penalty", "top_k", "min_p"]) {
    if (spec[key] !== undefined) out[key] = spec[key];
  }
  if (
    spec.top_p !== undefined &&
    !(
      modelFamily(spec) === MODEL_FAMILY_ID.GPT &&
      String(spec.model).toLowerCase().includes("gpt-5")
    )
  ) {
    out.top_p = spec.top_p;
  }
  return out;
}
