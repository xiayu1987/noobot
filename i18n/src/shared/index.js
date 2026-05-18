/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SUPPORTED_LOCALES = new Set(["zh-CN", "en-US"]);
export const DEFAULT_LOCALE = "zh-CN";

export function normalizeLocale(inputLocale = "", fallbackLocale = DEFAULT_LOCALE) {
  const normalized = String(inputLocale || "").trim();
  if (SUPPORTED_LOCALES.has(normalized)) return normalized;
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("zh")) return "zh-CN";
  if (lowered.startsWith("en")) return "en-US";
  return String(fallbackLocale || DEFAULT_LOCALE).trim() || DEFAULT_LOCALE;
}

export function resolveLocaleFromAcceptLanguage(
  acceptLanguage = "",
  fallbackLocale = DEFAULT_LOCALE,
) {
  const headerText = String(acceptLanguage || "").trim();
  if (!headerText) return normalizeLocale("", fallbackLocale);
  const first = headerText
    .split(",")
    .map((item) => item.split(";")[0].trim())
    .find(Boolean);
  return normalizeLocale(first, fallbackLocale);
}

export function resolveLocaleFromRuntime(runtime = {}, fallbackLocale = DEFAULT_LOCALE) {
  return normalizeLocale(
    runtime?.systemRuntime?.config?.locale || runtime?.locale || "",
    fallbackLocale,
  );
}

export function pickLocaleText({
  locale = DEFAULT_LOCALE,
  dict = {},
  key = "",
  fallbackLocale = DEFAULT_LOCALE,
  params = {},
} = {}) {
  const normalizedKey = String(key || "").trim();
  const row = dict?.[normalizedKey] || {};
  const normalizedLocale = normalizeLocale(locale, fallbackLocale);
  const value =
    row?.[normalizedLocale] ??
    row?.[normalizeLocale(fallbackLocale, DEFAULT_LOCALE)] ??
    normalizedKey;
  if (typeof value === "function") return String(value(params) ?? "");
  return String(value ?? "");
}
