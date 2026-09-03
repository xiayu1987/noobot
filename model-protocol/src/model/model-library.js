/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import libraryPayload from "../../model-library.json" with { type: "json" };
import { normalizeModelReasoningConfiguration } from "./provider-spec.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The library is the source of the reasoning facts, so its declarations must
 * already be canonical: normalization here may confirm them but never alter
 * them.
 */
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
  }
  return payload.providers;
}

const MODEL_LIBRARY_PROVIDERS = validateLibrary(libraryPayload);
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

/** Resolve the canonical provider declaration for a configured concrete model. */
export function resolveModelLibraryProviderByModel(model = "") {
  const identity = String(model || "")
    .trim()
    .toLowerCase();
  if (!identity) return null;
  const entry = Object.values(MODEL_LIBRARY_PROVIDERS).find(
    (provider) =>
      String(provider.model || "")
        .trim()
        .toLowerCase() === identity,
  );
  return entry ? clone(entry) : null;
}

export function resolveDefaultModelLibraryProvider() {
  return clone(GENERIC_PROVIDER_TEMPLATE);
}
