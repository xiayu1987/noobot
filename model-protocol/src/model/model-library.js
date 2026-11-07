/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveModelGenerationApiType } from "./model-capabilities.js";
import libraryPayload from "../../model-library.json" with { type: "json" };
import {
  normalizeModelPromptCacheFields,
  normalizeModelPromptCacheSelection,
  normalizeModelReasoningConfiguration,
} from "./provider-spec.js";
import { isPlainObject, text } from "@noobot/shared/value";

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
  normalizeModelPromptCacheSelection(provider, label);
}

function validateLibrary(payload) {
  if (!Number.isInteger(payload?.version) || payload.version < 1) {
    throw new TypeError("model library version must be a positive integer");
  }
  if (!isPlainObject(payload?.providers)) {
    throw new TypeError("model library providers are required");
  }
  for (const [alias, provider] of Object.entries(payload.providers)) {
    if (!alias || !isPlainObject(provider)) {
      throw new TypeError(`invalid model library provider: ${alias || "missing"}`);
    }
    if (provider.is_custom !== false) {
      throw new TypeError(`model library provider ${alias}.is_custom must be false`);
    }
    for (const field of ["model", "supplier", "api_key", "base_url"]) {
      if (!text(provider[field])) {
        throw new TypeError(`model library provider ${alias}.${field} is required`);
      }
    }
    if (provider.multimodal_generation?.support_generation?.enabled)
      resolveModelGenerationApiType(provider);
    validateReasoningConfiguration(provider, `model library provider ${alias}`);
    validatePromptCacheConfiguration(provider, `model library provider ${alias}`);
  }
  return payload.providers;
}

const MODEL_LIBRARY_PROVIDERS = validateLibrary(libraryPayload);

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function createModelReleaseIndex(releases, providers) {
  if (!isPlainObject(releases)) throw new TypeError("model library releases are required");
  const models = new Set(Object.values(providers).map(({ model }) => model));
  const index = new Map();
  for (const [model, release] of Object.entries(releases)) {
    if (
      !models.has(model) ||
      !isPlainObject(release) ||
      !isCalendarDate(release.date) ||
      typeof release.source !== "string" ||
      !release.source.startsWith("https://")
    ) {
      throw new TypeError(`invalid model library release: ${model}`);
    }
    index.set(model, Object.freeze({ date: release.date, source: release.source }));
  }
  return index;
}

const MODEL_RELEASES = createModelReleaseIndex(libraryPayload.releases, MODEL_LIBRARY_PROVIDERS);
export const MODEL_LIBRARY_VERSION = libraryPayload.version;
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
  if (!text(GENERIC_PROVIDER_TEMPLATE[field])) {
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
      description: text(provider.description),
      reasoning_effort: provider.reasoning_effort,
      tool_reasoning_effort: provider.tool_reasoning_effort,
      reasoning_effort_options: [...provider.reasoning_effort_options],
      reasoning_effort_parameter: provider.reasoning_effort_parameter,
    }),
  );
}

export function resolveModelLibraryProvider(alias = "") {
  const key = text(alias);
  const provider = MODEL_LIBRARY_PROVIDERS[key];
  return isPlainObject(provider) ? clone(provider) : null;
}

export function resolveDefaultModelLibraryProvider() {
  return clone(GENERIC_PROVIDER_TEMPLATE);
}

export function resolveModelRelease(model) {
  return MODEL_RELEASES.get(model) ?? null;
}

export function sortModelsByReleaseDate(models) {
  return models
    .map((item) => ({ item, date: resolveModelRelease(item.model)?.date ?? "" }))
    .sort((left, right) => Number(right.date > left.date) - Number(right.date < left.date))
    .map(({ item }) => item);
}
