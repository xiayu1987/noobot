/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import libraryPayload from "../../model-library.json" with { type: "json" };
import {
  normalizeModelPromptCacheFields,
  normalizeModelReasoningConfiguration,
  resolveModelFamilyPromptCacheFields,
} from "./provider-spec.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateReasoningConfiguration(provider, label) {
  let normalized;
  try {
    normalized = normalizeModelReasoningConfiguration(provider);
  } catch (error) {
    throw new TypeError(`${label}: ${error.message}`);
  }
  for (const [field, value] of Object.entries(normalized)) {
    if (JSON.stringify(provider[field]) !== JSON.stringify(value)) {
      throw new TypeError(`${label}.${field} is not a canonical reasoning declaration`);
    }
  }
}

function validatePromptCacheConfiguration(provider, label) {
  if (!Object.hasOwn(provider, "prompt_cache_fields")) {
    throw new TypeError(`${label}.prompt_cache_fields is required`);
  }
  const configured = normalizeModelPromptCacheFields(provider.prompt_cache_fields);
  const familyFields = new Set(resolveModelFamilyPromptCacheFields(provider));
  for (const field of configured) {
    if (!familyFields.has(field)) {
      throw new TypeError(
        `${label}.prompt_cache_fields value ${field} is outside its model family`,
      );
    }
  }
}

function validateLibrary(payload) {
  if (!isPlainObject(payload?.providers)) {
    throw new TypeError("model library providers are required");
  }
  for (const [alias, provider] of Object.entries(payload.providers)) {
    if (!alias || !isPlainObject(provider)) {
      throw new TypeError(`invalid model library provider: ${alias || "missing"}`);
    }
    for (const field of ["model", "api_key", "base_url"]) {
      if (!String(provider[field] || "").trim()) {
        throw new TypeError(`model library provider ${alias}.${field} is required`);
      }
    }
    validateReasoningConfiguration(provider, `model library provider ${alias}`);
    validatePromptCacheConfiguration(provider, `model library provider ${alias}`);
  }
  return payload.providers;
}

const MODEL_LIBRARY_PROVIDERS = validateLibrary(libraryPayload);
const MODEL_LIBRARY_CACHE_FIELDS = new Map();
for (const provider of Object.values(MODEL_LIBRARY_PROVIDERS)) {
  const model = String(provider.model).trim().toLowerCase();
  const fields = normalizeModelPromptCacheFields(provider.prompt_cache_fields);
  const existing = MODEL_LIBRARY_CACHE_FIELDS.get(model);
  if (existing && JSON.stringify(existing) !== JSON.stringify(fields)) {
    throw new TypeError(`model library has conflicting prompt cache facts for model ${model}`);
  }
  MODEL_LIBRARY_CACHE_FIELDS.set(model, fields);
}
const GENERIC_PROVIDER_TEMPLATE = isPlainObject(libraryPayload.defaults?.generic_provider)
  ? clone(libraryPayload.defaults.generic_provider)
  : null;

if (!GENERIC_PROVIDER_TEMPLATE) {
  throw new TypeError("model library defaults.generic_provider is required");
}
for (const field of ["model", "api_key", "base_url"]) {
  if (!String(GENERIC_PROVIDER_TEMPLATE[field] || "").trim()) {
    throw new TypeError(`model library generic provider ${field} is required`);
  }
}
validateReasoningConfiguration(GENERIC_PROVIDER_TEMPLATE, "model library generic provider");
validatePromptCacheConfiguration(GENERIC_PROVIDER_TEMPLATE, "model library generic provider");

export function listModelLibraryOptions() {
  return Object.entries(MODEL_LIBRARY_PROVIDERS).map(([key, provider]) =>
    Object.freeze({
      key,
      model: provider.model,
      description: String(provider.description || "").trim(),
      reasoning_effort: provider.reasoning_effort,
      tool_reasoning_effort: provider.tool_reasoning_effort,
      reasoning_effort_options: [...provider.reasoning_effort_options],
      reasoning_effort_parameter: provider.reasoning_effort_parameter,
    }),
  );
}

export function resolveModelLibraryProvider(alias = "") {
  const key = String(alias || "").trim();
  const provider = MODEL_LIBRARY_PROVIDERS[key];
  return isPlainObject(provider) ? clone(provider) : null;
}

export function resolveDefaultModelLibraryProvider() {
  return clone(GENERIC_PROVIDER_TEMPLATE);
}

export function resolveModelLibraryPromptCacheFields(model = "") {
  const fields = MODEL_LIBRARY_CACHE_FIELDS.get(String(model).trim().toLowerCase());
  return fields ? Object.freeze([...fields]) : null;
}
