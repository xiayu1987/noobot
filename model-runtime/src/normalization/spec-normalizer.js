/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_PROVIDER_CONFIG_CONTRACT,
  MODEL_PROVIDER_CONFIG_VALUE_TYPE,
  MODEL_SAMPLING_FIELDS,
  normalizeModelReasoningConfiguration,
  normalizeModelSamplingFields,
  resolveModelAdapterId,
  resolveModelFamilyId,
  resolveModelOperatorId,
} from "@noobot/model-protocol";

const SAMPLING_NEUTRAL_DEFAULT_FIELDS = Object.freeze({
  temperature: 0.7,
  top_p: 1,
  min_p: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
});

const TRANSPORT_DEFAULT_FIELDS = Object.freeze({
  max_tokens: 10000,
});

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
    match: /^qwen3.*thinking(?:[-_.]|$)/,
    defaults: Object.freeze({ temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 }),
  }),
]);

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function resolveConcreteModelDefaults(model = "") {
  const normalized = String(model || "")
    .trim()
    .toLowerCase();
  return CONCRETE_MODEL_RULES.find(({ match }) => match.test(normalized))?.defaults || {};
}

function assertContractValue(key, value) {
  const contract = MODEL_PROVIDER_CONFIG_CONTRACT.properties[key];
  const integer = contract.type === MODEL_PROVIDER_CONFIG_VALUE_TYPE.INTEGER;
  const valid =
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    (contract.minimum === undefined || value >= contract.minimum) &&
    (contract.maximum === undefined || value <= contract.maximum);
  if (valid) return;
  const kind = integer ? "an integer" : "a number";
  const range = [contract.minimum, contract.maximum].map((bound) => bound ?? "∞").join(" and ");
  throw new TypeError(`model spec.${key} must be ${kind} between ${range}`);
}

export function normalizeRuntimeModelSpec(input = {}, reasoningFallback = {}) {
  const out = { ...input };
  delete out.providerId;
  out.model = String(out.model || "").trim();
  out.alias = String(out.alias || "").trim();
  if (!out.model) throw new TypeError("model spec.model is required");

  delete out.adapterId;
  delete out.adapter_id;
  out.operatorId = resolveModelOperatorId({
    baseUrl: out.base_url || out.baseUrl || "",
  });
  out.modelFamily = resolveModelFamilyId(out);
  out.adapterId = resolveModelAdapterId({ modelFamily: out.modelFamily });
  Object.assign(out, normalizeModelReasoningConfiguration(out, reasoningFallback));
  out.sampling_fields = normalizeModelSamplingFields(out.sampling_fields);
  const defaults = { ...SAMPLING_NEUTRAL_DEFAULT_FIELDS, ...TRANSPORT_DEFAULT_FIELDS };
  Object.assign(defaults, OPERATOR_DEFAULT_FIELDS[out.operatorId] || {});
  Object.assign(defaults, MODEL_FAMILY_DEFAULT_FIELDS[out.modelFamily] || {});
  Object.assign(defaults, resolveConcreteModelDefaults(out.model));

  const selected = new Set(out.sampling_fields);
  for (const key of MODEL_SAMPLING_FIELDS) {
    const configured = out[key] !== undefined && out[key] !== null;
    if (configured) assertContractValue(key, out[key]);
    if (!selected.has(key)) {
      delete out[key];
      continue;
    }
    if (configured) continue;
    if (defaults[key] === undefined) {
      delete out[key];
      continue;
    }
    out[key] = defaults[key];
  }
  if (!hasOwn(out, "max_tokens")) out.max_tokens = defaults.max_tokens;
  if (out.max_tokens !== undefined) {
    if (!Number.isInteger(out.max_tokens) || out.max_tokens <= 0) {
      throw new TypeError("model spec.max_tokens must be a positive integer");
    }
  }
  return out;
}
