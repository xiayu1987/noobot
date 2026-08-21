/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeConfigParamList(input = []) {
  const source = Array.isArray(input) ? input : [];
  const values = new Map();
  for (const item of source) {
    const key = String(item?.key || "").trim();
    if (!key) continue;
    values.set(key, String(item?.value ?? "").trim());
  }
  return Array.from(values.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function configParamsFromCatalog({ catalog = [], values = {} } = {}) {
  return normalizeConfigParamList(
    (Array.isArray(catalog) ? catalog : []).map((item) => ({
      key: String(item?.key || "").trim(),
      value: String(values?.[item?.key] ?? "").trim(),
    })),
  );
}

export function assertConfigParamListMatchesCatalog(list = [], catalog = []) {
  const allowedKeys = new Set(
    (Array.isArray(catalog) ? catalog : [])
      .map((item) => String(item?.key || "").trim())
      .filter(Boolean),
  );
  const unknownKeys = normalizeConfigParamList(list)
    .map((item) => item.key)
    .filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    const error = new Error(`Unknown config param key: ${unknownKeys[0]}`);
    error.code = "UNKNOWN_CONFIG_PARAM_KEY";
    error.key = unknownKeys[0];
    throw error;
  }
  return true;
}
