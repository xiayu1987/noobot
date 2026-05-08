/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export { isAbortError } from "../utils/error-utils.js";

export function isValidSessionId(sessionId = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(sessionId || ""),
  );
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeConfigParams(input = {}) {
  const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
  return Object.fromEntries(
    Object.entries(rawValues)
      .map(([paramKey, paramValue]) => [
        String(paramKey || "").trim(),
        String(paramValue ?? "").trim(),
      ])
      .filter(([paramKey]) => Boolean(paramKey)),
  );
}

export function mergeConfigParamsWithFallback(systemParams = {}, userParams = {}) {
  const base = {
    ...(systemParams && typeof systemParams === "object" ? systemParams : {}),
  };
  const userSource = userParams && typeof userParams === "object" ? userParams : {};
  for (const [paramKey, rawValue] of Object.entries(userSource)) {
    const normalizedKey = String(paramKey || "").trim();
    if (!normalizedKey) continue;
    const normalizedValue = String(rawValue ?? "").trim();
    if (!normalizedValue) continue;
    base[normalizedKey] = normalizedValue;
  }
  return base;
}
