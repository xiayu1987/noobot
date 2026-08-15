/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import libraryPayload from "../../model-library.json" with { type: "json" };

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateLibrary(payload) {
  if (!isPlainObject(payload?.providers)) {
    throw new TypeError("model library providers are required");
  }
  for (const [alias, provider] of Object.entries(payload.providers)) {
    if (!alias || !isPlainObject(provider)) {
      throw new TypeError(`invalid model library provider: ${alias || "missing"}`);
    }
    for (const field of ["model", "format", "api_key", "base_url"]) {
      if (!String(provider[field] || "").trim()) {
        throw new TypeError(`model library provider ${alias}.${field} is required`);
      }
    }
  }
  return payload.providers;
}

const MODEL_LIBRARY_PROVIDERS = validateLibrary(libraryPayload);

export function listModelLibraryOptions() {
  return Object.entries(MODEL_LIBRARY_PROVIDERS).map(([key, provider]) =>
    Object.freeze({
      key,
      model: provider.model,
      format: provider.format,
      description: String(provider.description || "").trim(),
    }),
  );
}

export function resolveModelLibraryProvider(alias = "") {
  const key = String(alias || "").trim();
  const provider = MODEL_LIBRARY_PROVIDERS[key];
  return isPlainObject(provider) ? clone(provider) : null;
}
