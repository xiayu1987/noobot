/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveModelAdapterId, resolveModelOperatorId } from "@noobot/model-protocol";

export const MODEL_DEFAULT_FIELDS_BY_FORMAT = Object.freeze({
  openai_compatible: Object.freeze({
    default: Object.freeze({
      temperature: 0.7,
      max_tokens: 10000,
    }),
    gemini: Object.freeze({
      temperature: 1,
      top_p: 0.95,
    }),
    gpt: Object.freeze({ temperature: 0.7 }),
    gpt_5: Object.freeze({ temperature: 0.7 }),
    gpt_codex: Object.freeze({ temperature: 0.7 }),
    gemini_flash: Object.freeze({ temperature: 1, top_p: 0.95 }),
    gemini_pro: Object.freeze({ temperature: 1, top_p: 0.95 }),
    nano_banana: Object.freeze({ temperature: 0.5 }),
  }),
});

// Defaults are layered in this order: transport format -> operator -> model
// family -> concrete model. Explicit fields in the user's model config always
// win over every inferred default.
const OPERATOR_DEFAULT_FIELDS = Object.freeze({
  openai: Object.freeze({}),
  anthropic: Object.freeze({}),
  google: Object.freeze({ temperature: 1, top_p: 0.95 }),
  alibaba: Object.freeze({ top_p: 0.8, top_k: 20, min_p: 0 }),
  zhipu: Object.freeze({ temperature: 0.7, top_p: 0.8 }),
  generic: Object.freeze({}),
});

const MODEL_FAMILY_DEFAULT_FIELDS = Object.freeze({
  gpt: Object.freeze({ temperature: 0.7 }),
  claude: Object.freeze({ temperature: 0.7 }),
  gemini: Object.freeze({ temperature: 1, top_p: 0.95 }),
  qwen: Object.freeze({ temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 }),
  glm: Object.freeze({ temperature: 0.7, top_p: 0.8 }),
  deepseek: Object.freeze({ temperature: 0.7 }),
  generic: Object.freeze({}),
});

const CONCRETE_MODEL_RULES = Object.freeze([
  Object.freeze({
    match: /^gpt[-_]?5\.6[-_.]?sol(?:[-_.]|$)/,
    defaults: Object.freeze({ temperature: 0.7 }),
  }),
  Object.freeze({
    match: /^nano[-_.]?banana(?:[-_.]|$)/,
    defaults: Object.freeze({ temperature: 0.5 }),
  }),
  Object.freeze({
    match: /^qwen3.*thinking(?:[-_.]|$)/,
    defaults: Object.freeze({ temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 }),
  }),
]);

const MODEL_PROFILE_RULES = Object.freeze([
  Object.freeze({ match: /gemini/, profile: "gemini" }),
  Object.freeze({ match: /gemini.*pro/, profile: "gemini_pro" }),
  Object.freeze({ match: /gemini.*flash/, profile: "gemini_flash" }),
  Object.freeze({ match: /nano[-_.]?banana/, profile: "nano_banana" }),
  Object.freeze({ match: /gpt/, profile: "gpt" }),
  Object.freeze({ match: /gpt-5|gpt5/, profile: "gpt_5" }),
  Object.freeze({ match: /codex/, profile: "gpt_codex" }),
  Object.freeze({ match: /qianwen/, profile: "qwen" }),
  Object.freeze({ match: /qwen/, profile: "qwen" }),
  Object.freeze({ match: /qwen.*coder/, profile: "qwen_coder" }),
  Object.freeze({ match: /qwen.*omni/, profile: "qwen_omni" }),
  Object.freeze({ match: /qwen.*flash/, profile: "qwen_flash" }),
  Object.freeze({ match: /qwen.*thinking|thinking.*qwen/, profile: "qwen_thinking" }),
]);

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveModelProfiles(modelSpec = {}) {
  // An alias is a configuration label, not part of the provider's model
  // identity. Only the actual model name may select a family/profile.
  const identity = String(modelSpec.model || "")
    .trim()
    .toLowerCase();
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
  if (
    String(modelSpec.format || "")
      .trim()
      .toLowerCase() === "openai_compatible" &&
    hasOwn(modelSpec, "top_p") &&
    !hasOwn(modelSpec, "temperature")
  ) {
    delete defaults.temperature;
  }
  return defaults;
}

function classifyModelFamily(modelSpec = {}) {
  const model = String(modelSpec.model || "").toLowerCase();
  if (/claude|anthropic/.test(model)) return "claude";
  if (/gemini|nano[-_.]?banana/.test(model)) return "gemini";
  if (/qwen|qianwen/.test(model)) return "qwen";
  if (/glm|zhipu/.test(model)) return "glm";
  if (/deepseek/.test(model)) return "deepseek";
  if (/gpt|codex|\bo[1-9]/.test(model)) return "gpt";
  return "generic";
}

function resolveConcreteModelDefaults(model = "") {
  const normalized = String(model || "")
    .trim()
    .toLowerCase();
  return CONCRETE_MODEL_RULES.find(({ match }) => match.test(normalized))?.defaults || {};
}

export function normalizeRuntimeModelSpec(input = {}) {
  const out = { ...input };
  delete out.providerId;
  out.model = String(out.model || "").trim();
  out.alias = String(out.alias || "").trim();
  out.format = String(out.format || "")
    .trim()
    .toLowerCase();
  if (!out.model) throw new TypeError("model spec.model is required");
  if (!out.format) throw new TypeError("model spec.format is required");
  out.operatorId = resolveModelOperatorId({
    format: out.format,
    baseUrl: out.base_url || out.baseUrl || "",
  });
  out.modelFamily = classifyModelFamily(out);
  out.adapterId = resolveModelAdapterId(out.format);
  const defaults = getRuntimeModelDefaultFields(out);
  Object.assign(defaults, OPERATOR_DEFAULT_FIELDS[out.operatorId] || {});
  Object.assign(defaults, MODEL_FAMILY_DEFAULT_FIELDS[out.modelFamily] || {});
  Object.assign(defaults, resolveConcreteModelDefaults(out.model));
  // OpenAI defines temperature and top_p as alternative sampling controls.
  // Apply this invariant after every default layer so a family default cannot
  // reintroduce temperature when the user selected top_p explicitly.
  if (out.format === "openai_compatible" && hasOwn(out, "top_p") && !hasOwn(out, "temperature")) {
    delete defaults.temperature;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (!hasOwn(out, key)) out[key] = value;
  }
  for (const [key, min, max] of [
    ["temperature", 0, 2],
    ["top_p", 0.01, 1],
    ["frequency_penalty", -2, 2],
    ["presence_penalty", -2, 2],
    ["top_k", 1, 100],
    ["min_p", 0, 1],
  ]) {
    if (out[key] === undefined) continue;
    const value = out[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      throw new TypeError(`model spec.${key} must be a number between ${min} and ${max}`);
    }
  }
  if (out.max_tokens !== undefined) {
    if (!Number.isInteger(out.max_tokens) || out.max_tokens <= 0) {
      throw new TypeError("model spec.max_tokens must be a positive integer");
    }
  }
  return out;
}
