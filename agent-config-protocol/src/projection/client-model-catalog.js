/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../utils.js";
import { resolveModelMultimodalCapabilities } from "@noobot/model-protocol";
import { supportsModelReference } from "../contract/model-reference.js";

function readText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createClientModelOption(alias = "", provider = {}) {
  return Object.freeze({
    alias: readText(alias),
    model: readText(provider?.model),
    description: readText(provider?.description),
    supplier: readText(provider?.supplier),
    inputModalities: Object.freeze(
      Array.isArray(provider?.inputModalities) ? [...provider.inputModalities] : [],
    ),
    outputModalities: Object.freeze(
      Array.isArray(provider?.outputModalities) ? [...provider.outputModalities] : [],
    ),
  });
}

export function createClientModelOptions(providers = {}, requirement = "model") {
  supportsModelReference(null, requirement);
  return Object.entries(isPlainObject(providers) ? providers : {})
    .filter(([alias, provider]) => readText(alias) && supportsModelReference(provider, requirement))
    .map(([alias, provider]) => projectClientModelOption(alias, provider));
}

export function createClientModelCatalog({ providers = {}, defaultAlias = "" } = {}) {
  const enabledModels = createClientModelOptions(providers, "conversation");
  const configuredDefault = readText(defaultAlias);
  const defaultModelAlias = enabledModels.some((item) => item.alias === configuredDefault)
    ? configuredDefault
    : "";
  return Object.freeze({ enabledModels: Object.freeze(enabledModels), defaultModelAlias });
}

export function projectClientModelOption(alias = "", provider = {}) {
  const capabilities = resolveModelMultimodalCapabilities(provider);
  return createClientModelOption(alias, {
    ...provider,
    inputModalities: capabilities.parsing.enabled ? capabilities.parsing.inputModalities : [],
    outputModalities: capabilities.generation.enabled
      ? capabilities.generation.outputModalities
      : [],
  });
}

export function normalizeClientModelOptions(enabledModels = []) {
  const seen = new Set();
  return (Array.isArray(enabledModels) ? enabledModels : [])
    .filter(isPlainObject)
    .map((item) => createClientModelOption(item.alias, item))
    .filter((item) => item.alias && !seen.has(item.alias) && seen.add(item.alias));
}
