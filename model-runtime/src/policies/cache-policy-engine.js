/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const OPENAI_MODELS = [/^gpt-4\.1(?:\b|[-_.])/, /^gpt-5(?:\b|[-_.])/];
const PROVIDER_IDS = new Set(["openai", "anthropic", "gemini", "deepseek", "dashscope", "zhipu"]);

function providerId(spec = {}) {
  const value = String(spec.providerId || "")
    .trim()
    .toLowerCase();
  if (!value) throw new TypeError("model spec.providerId is required");
  if (!PROVIDER_IDS.has(value)) throw new TypeError(`unsupported model providerId: ${value}`);
  return value;
}

function segment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveCacheVendor(spec = {}) {
  return providerId(spec);
}

export function buildPromptCacheKey(spec = {}, flow = "agent.main") {
  if (providerId(spec) !== "openai") return "";
  const model = segment(spec.model);
  if (!model) return "";
  const normalizedFlow = segment(flow);
  return (
    normalizedFlow && normalizedFlow !== "agent-main"
      ? `noobot-${normalizedFlow}-${model}`
      : `noobot-main-${model}`
  ).slice(0, 200);
}

function gptVersion(name = "") {
  const match = String(name)
    .toLowerCase()
    .match(/\bgpt[-_]?(\d+)(?:\.(\d+))?(?:\b|[-_])/);
  return match ? { major: Number(match[1]), minor: Number(match[2] || 0) } : null;
}

export function compileProviderModelKwargs(spec = {}, flow = "agent.main") {
  const vendor = providerId(spec);
  const format = String(spec.format || "")
    .trim()
    .toLowerCase();
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

  if (vendor === "openai") {
    const key =
      String(spec.prompt_cache_key ?? spec.promptCacheKey ?? "").trim() ||
      buildPromptCacheKey(spec, flow);
    if (key) out.prompt_cache_key = key;
    const version = gptVersion(spec.model);
    if (version?.major === 5 && version.minor >= 6) {
      out.prompt_cache_options = spec.prompt_cache_options ||
        spec.promptCacheOptions || { ttl: "30m" };
    } else if (OPENAI_MODELS.some((pattern) => pattern.test(String(spec.model).toLowerCase()))) {
      out.prompt_cache_retention = String(
        spec.prompt_cache_retention || spec.promptCacheRetention || "24h",
      );
    }
  }

  if (vendor === "anthropic") {
    const value = spec.cache_control ?? spec.prompt_cache_control ?? spec.promptCacheControl;
    if (value !== false) {
      out.cache_control =
        value && typeof value === "object"
          ? { type: value.type || "ephemeral", ...(value.ttl === "1h" ? { ttl: "1h" } : {}) }
          : { type: "ephemeral" };
    }
  }

  if (vendor === "gemini") {
    const value = String(
      spec.cached_content ?? spec.cachedContent ?? spec.gemini_cached_content ?? "",
    ).trim();
    if (value) out.cached_content = value;
  }

  for (const key of ["reasoning_effort", "frequency_penalty", "presence_penalty"]) {
    if (spec[key] !== undefined) out[key] = spec[key];
  }
  if (
    spec.top_p !== undefined &&
    !(vendor === "openai" && String(spec.model).toLowerCase().includes("gpt-5"))
  ) {
    out.top_p = spec.top_p;
  }
  if (format === "dashscope") {
    if (spec.enable_thinking !== undefined) out.enable_thinking = spec.enable_thinking === true;
    if (spec.preserve_thinking !== undefined) out.preserve_thinking = spec.preserve_thinking;
    if (spec.thinking_budget !== undefined) {
      out.thinking_budget = Math.max(0, Math.floor(Number(spec.thinking_budget) || 0));
    }
  }
  return out;
}
