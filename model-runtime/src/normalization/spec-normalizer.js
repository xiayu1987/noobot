/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_FAMILY_ID,
  normalizeModelReasoningConfiguration,
  resolveModelAdapterId,
  resolveModelOperatorId,
} from "@noobot/model-protocol";

// The transport baseline. Provider-, family- and model-specific values are
// layered on top of it by `normalizeRuntimeModelSpec`.
const TRANSPORT_DEFAULT_FIELDS = Object.freeze({
  temperature: 0.7,
  max_tokens: 10000,
});

// Defaults are layered in this order: transport -> operator -> model family ->
// concrete model. Explicit fields in the user's model config always win over
// every inferred default.
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

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

/**
 * The model family drives sampling defaults only. Transport contracts such as
 * the reasoning parameter are declared by the provider, never inferred here.
 */
function classifyModelFamily(modelSpec = {}) {
  const model = String(modelSpec.model || "").toLowerCase();
  if (/grok|xai/.test(model)) return MODEL_FAMILY_ID.GROK;
  if (/claude|anthropic/.test(model)) return MODEL_FAMILY_ID.CLAUDE;
  if (/gemini|nano[-_.]?banana/.test(model)) return MODEL_FAMILY_ID.GEMINI;
  if (/qwen|qianwen/.test(model)) return MODEL_FAMILY_ID.QWEN;
  if (/glm|zhipu/.test(model)) return MODEL_FAMILY_ID.GLM;
  if (/deepseek/.test(model)) return MODEL_FAMILY_ID.DEEPSEEK;
  if (/kimi|moonshot/.test(model)) return MODEL_FAMILY_ID.KIMI;
  if (/gpt|codex|\bo[1-9]/.test(model)) return MODEL_FAMILY_ID.GPT;
  return MODEL_FAMILY_ID.GENERIC;
}

function resolveConcreteModelDefaults(model = "") {
  const normalized = String(model || "")
    .trim()
    .toLowerCase();
  return CONCRETE_MODEL_RULES.find(({ match }) => match.test(normalized))?.defaults || {};
}

export function normalizeRuntimeModelSpec(input = {}, reasoningFallback = {}) {
  const out = { ...input };
  delete out.providerId;
  out.model = String(out.model || "").trim();
  out.alias = String(out.alias || "").trim();
  if (!out.model) throw new TypeError("model spec.model is required");
  out.operatorId = resolveModelOperatorId({
    baseUrl: out.base_url || out.baseUrl || "",
  });
  out.modelFamily = classifyModelFamily(out);
  out.adapterId = resolveModelAdapterId();
  Object.assign(out, normalizeModelReasoningConfiguration(out, reasoningFallback));
  const defaults = { ...TRANSPORT_DEFAULT_FIELDS };
  Object.assign(defaults, OPERATOR_DEFAULT_FIELDS[out.operatorId] || {});
  Object.assign(defaults, MODEL_FAMILY_DEFAULT_FIELDS[out.modelFamily] || {});
  Object.assign(defaults, resolveConcreteModelDefaults(out.model));
  // OpenAI defines temperature and top_p as alternative sampling controls.
  // Apply this invariant after every default layer so a family default cannot
  // reintroduce temperature when the user selected top_p explicitly.
  if (hasOwn(out, "top_p") && !hasOwn(out, "temperature")) {
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
