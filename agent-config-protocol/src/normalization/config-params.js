/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";

export function normalizeConfigParamKey(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function normalizeConfigParamValues(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = normalizeConfigParamKey(rawKey);
    const value = String(rawValue ?? "").trim();
    if (!key || !value) continue;
    normalized[key] = value;
  }
  return normalized;
}

export function normalizeConfigParamsDocument(document = {}) {
  if (!isPlainObject(document)) {
    throw new TypeError("config params document must be an object");
  }
  if (document.values !== undefined && !isPlainObject(document.values)) {
    throw new TypeError("config params document values must be an object");
  }
  return normalizeConfigParamValues(document.values || {});
}

export function mergeConfigParamLayers(...layers) {
  return Object.assign({}, ...layers.map((layer) => normalizeConfigParamValues(layer)));
}
