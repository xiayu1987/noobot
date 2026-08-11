/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_DEFAULT_FIELDS_BY_FORMAT = Object.freeze({
  openai_compatible: Object.freeze({
    default: Object.freeze({
      temperature: 0.65,
      top_p: 1,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
    gemini: Object.freeze({
      temperature: 0.7,
      top_p: 0.95,
      frequency_penalty: 0.05,
      presence_penalty: 0.05,
    }),
    gpt: Object.freeze({ temperature: 0.6, top_p: 1 }),
    gpt_codex: Object.freeze({
      temperature: 0.45,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    }),
    gpt_5: Object.freeze({
      temperature: 0.55,
      top_p: 1,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
    gemini_flash: Object.freeze({
      temperature: 0.75,
      top_p: 0.95,
      frequency_penalty: 0.05,
      presence_penalty: 0.05,
    }),
    gemini_pro: Object.freeze({
      temperature: 0.6,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
  }),
  dashscope: Object.freeze({
    default: Object.freeze({
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
    qwen: Object.freeze({
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
    qwen_coder: Object.freeze({
      temperature: 0.55,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      thinking_budget: 0,
    }),
    qwen_omni: Object.freeze({
      temperature: 0.6,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.15,
      thinking_budget: 0,
    }),
    qwen_flash: Object.freeze({
      temperature: 0.75,
      top_p: 0.9,
      frequency_penalty: 0.25,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
  }),
});

const MODEL_PROFILE_RULES = Object.freeze([
  Object.freeze({ match: /gemini/, profile: "gemini" }),
  Object.freeze({ match: /gemini.*pro/, profile: "gemini_pro" }),
  Object.freeze({ match: /gemini.*flash/, profile: "gemini_flash" }),
  Object.freeze({ match: /gpt/, profile: "gpt" }),
  Object.freeze({ match: /codex/, profile: "gpt_codex" }),
  Object.freeze({ match: /gpt-5|gpt5/, profile: "gpt_5" }),
  Object.freeze({ match: /qianwen/, profile: "qwen" }),
  Object.freeze({ match: /qwen/, profile: "qwen" }),
  Object.freeze({ match: /qwen.*coder/, profile: "qwen_coder" }),
  Object.freeze({ match: /qwen.*omni/, profile: "qwen_omni" }),
  Object.freeze({ match: /qwen.*flash/, profile: "qwen_flash" }),
]);

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveModelProfiles(modelSpec = {}) {
  const identity =
    `${String(modelSpec.alias || "").trim()} ${String(modelSpec.model || "").trim()}`.toLowerCase();
  return MODEL_PROFILE_RULES.filter(({ match }) => match.test(identity)).map(
    ({ profile }) => profile,
  );
}

export function getRuntimeModelDefaultFields(modelSpec = {}) {
  const formatDefaults =
    MODEL_DEFAULT_FIELDS_BY_FORMAT[
      String(modelSpec.format || "")
        .trim()
        .toLowerCase()
    ];
  if (!formatDefaults) return {};
  const defaults = { ...formatDefaults.default };
  for (const profile of resolveModelProfiles(modelSpec)) {
    Object.assign(defaults, formatDefaults[profile] || {});
  }
  return defaults;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
}

export function normalizeRuntimeModelSpec(input = {}) {
  const out = { ...input };
  out.model = String(out.model || "").trim();
  out.alias = String(out.alias || "").trim();
  out.format = String(out.format || "")
    .trim()
    .toLowerCase();
  out.providerId = String(out.providerId || "")
    .trim()
    .toLowerCase();
  out.adapterId = String(out.adapterId || "")
    .trim()
    .toLowerCase();
  if (!out.model) throw new TypeError("model spec.model is required");
  if (!out.format) throw new TypeError("model spec.format is required");
  if (!out.providerId) throw new TypeError("model spec.providerId is required");
  if (!out.adapterId) throw new TypeError("model spec.adapterId is required");
  const defaults = getRuntimeModelDefaultFields(out);
  for (const [key, value] of Object.entries(defaults)) {
    if (!hasOwn(out, key)) out[key] = value;
  }
  for (const [key, min, max] of [
    ["temperature", 0, 2],
    ["top_p", 0.01, 1],
    ["frequency_penalty", -2, 2],
    ["presence_penalty", -2, 2],
  ]) {
    if (out[key] === undefined) continue;
    const value = Number(out[key]);
    if (Number.isFinite(value)) out[key] = Math.min(max, Math.max(min, value));
    else delete out[key];
  }
  if (out.max_tokens !== undefined) {
    const value = Math.floor(Number(out.max_tokens));
    if (value > 0) out.max_tokens = value;
    else delete out.max_tokens;
  }
  if (out.thinking_budget !== undefined) {
    const value = Math.floor(Number(out.thinking_budget));
    out.thinking_budget = Number.isFinite(value) ? Math.min(131072, Math.max(0, value)) : 0;
  }
  if (out.format === "dashscope") {
    out.enable_thinking = normalizeBoolean(out.enable_thinking, false);
  }
  return out;
}
