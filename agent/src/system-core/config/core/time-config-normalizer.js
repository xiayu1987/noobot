/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logWarn } from "../../tracking/console/logger.js";

const LEGACY_TIME_KEY_WARN_CACHE = new Set();
const LEGACY_TIME_KEY_USAGE_COUNTER = new Map();

function increaseLegacyUsageCounter({
  sourceTag = "",
  key = "",
  legacyKey = "",
} = {}) {
  const tag = String(sourceTag || "").trim() || "unknown";
  const canonicalKey = String(key || "").trim() || "unknown";
  const legacy = String(legacyKey || "").trim() || "unknown";
  const counterKey = `${tag}::${canonicalKey}::${legacy}`;
  const current = Number(LEGACY_TIME_KEY_USAGE_COUNTER.get(counterKey) || 0);
  LEGACY_TIME_KEY_USAGE_COUNTER.set(counterKey, current + 1);
}

function normalizeBoundary(rawValue, fallback) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTimeMs(
  rawValue,
  {
    fallback = 0,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    allowZero = false,
  } = {},
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
    legacyKeys = [],
    sourceTag = "",
    warnLegacy = false,
    onLegacyKey = null,
    fallback = 0,
    min = 0,
    max = Number.POSITIVE_INFINITY,
    allowZero = false,
  } = {},
) {
  const normalizedSource =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const preferredKey = String(key || "").trim();
  const keyCandidates = [
    preferredKey,
    ...(Array.isArray(legacyKeys) ? legacyKeys : []),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  let rawValue;
  let resolvedKey = "";
  for (const candidateKey of keyCandidates) {
    if (!Object.prototype.hasOwnProperty.call(normalizedSource, candidateKey)) continue;
    const candidateValue = normalizedSource[candidateKey];
    if (candidateValue === undefined || candidateValue === null || candidateValue === "") continue;
    rawValue = candidateValue;
    resolvedKey = candidateKey;
    break;
  }

  const usedLegacyKey =
    resolvedKey &&
    resolvedKey !== preferredKey &&
    (Array.isArray(legacyKeys) ? legacyKeys : []).includes(resolvedKey);
  if (usedLegacyKey) {
    increaseLegacyUsageCounter({
      sourceTag,
      key: preferredKey,
      legacyKey: resolvedKey,
    });
    if (typeof onLegacyKey === "function") {
      onLegacyKey({
        key: preferredKey,
        legacyKey: resolvedKey,
        sourceTag: String(sourceTag || "").trim(),
      });
    }
    if (warnLegacy) {
      const tag = String(sourceTag || "").trim() || "unknown";
      const cacheKey = `${tag}::${preferredKey}::${resolvedKey}`;
      if (!LEGACY_TIME_KEY_WARN_CACHE.has(cacheKey)) {
        LEGACY_TIME_KEY_WARN_CACHE.add(cacheKey);
        logWarn("[time-config][deprecated_legacy_time_key]", {
          sourceTag: tag,
          key: preferredKey,
          legacyKey: resolvedKey,
          message: `Legacy time key "${resolvedKey}" is deprecated; prefer "${preferredKey}"`,
        });
      }
    }
  }

  return normalizeTimeMs(rawValue, {
    fallback,
    min,
    max,
    allowZero,
  });
}

export function __resetLegacyTimeKeyWarnCacheForTest() {
  LEGACY_TIME_KEY_WARN_CACHE.clear();
}

export function getLegacyTimeKeyUsageStats() {
  return Array.from(LEGACY_TIME_KEY_USAGE_COUNTER.entries())
    .map(([entryKey, count]) => {
      const [sourceTag = "", key = "", legacyKey = ""] = String(entryKey || "").split("::");
      return {
        sourceTag,
        key,
        legacyKey,
        count: Number(count || 0),
      };
    })
    .sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0));
}

export function __resetLegacyTimeKeyUsageStatsForTest() {
  LEGACY_TIME_KEY_USAGE_COUNTER.clear();
}
