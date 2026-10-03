/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "../utils.js";

function readText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createClientModelOption(alias = "", provider = {}) {
  return Object.freeze({
    alias: readText(alias),
    model: readText(provider?.model),
    description: readText(provider?.description),
  });
}

export function createClientModelCatalog({ providers = {}, defaultAlias = "" } = {}) {
  const enabledModels = Object.entries(isPlainObject(providers) ? providers : {})
    .filter(([alias, provider]) => readText(alias) && provider?.used_for_conversation === true)
    .map(([alias, provider]) => createClientModelOption(alias, provider));
  const configuredDefault = readText(defaultAlias);
  const defaultModelAlias = enabledModels.some((item) => item.alias === configuredDefault)
    ? configuredDefault
    : "";
  return Object.freeze({ enabledModels: Object.freeze(enabledModels), defaultModelAlias });
}

export function normalizeClientModelOptions(enabledModels = []) {
  const seen = new Set();
  return (Array.isArray(enabledModels) ? enabledModels : [])
    .filter(isPlainObject)
    .map((item) => createClientModelOption(item.alias, item))
    .filter((item) => item.alias && !seen.has(item.alias) && seen.add(item.alias));
}
