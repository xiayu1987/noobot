/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function normalizeBoundary(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTimeMs(
  rawValue,
  { fallback = 0, min = 0, max = Number.POSITIVE_INFINITY, allowZero = false } = {},
) {
  const parsed = Number(rawValue);
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  if (!Number.isFinite(parsed)) return fallbackValue;
  if (!allowZero && parsed <= 0) return fallbackValue;

  const normalizedMin = normalizeBoundary(min, 0);
  const normalizedMax = normalizeBoundary(max, Number.POSITIVE_INFINITY);
  const floored = Math.floor(parsed);
  return Math.min(normalizedMax, Math.max(normalizedMin, floored));
}

export function resolveTimeMs(
  source = {},
  {
    key = "",
    fallback = 0,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    allowZero = false,
  } = {},
) {
  const normalizedSource =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const canonicalKey = String(key || "").trim();
  const rawValue = canonicalKey ? normalizedSource[canonicalKey] : undefined;

  return normalizeTimeMs(rawValue, {
    fallback,
    min,
    max,
    allowZero,
  });
}
