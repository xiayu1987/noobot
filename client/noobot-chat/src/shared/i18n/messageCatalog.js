/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { messages } from "noobot-i18n/client/messages";

export const LOCALE_STORAGE_KEY = "noobot_locale";
export const FALLBACK_LOCALE = "zh-CN";
export const SUPPORTED_LOCALES = Object.freeze(["zh-CN", "en-US"]);

const SUPPORTED_LOCALE_SET = new Set(SUPPORTED_LOCALES);

export function isSupportedLocale(value = "") {
  return SUPPORTED_LOCALE_SET.has(String(value || "").trim());
}

export function normalizeLocale(value = "") {
  const normalized = String(value || "").trim();
  return isSupportedLocale(normalized) ? normalized : FALLBACK_LOCALE;
}

export function readStoredLocale() {
  return String(globalThis?.localStorage?.getItem?.(LOCALE_STORAGE_KEY) || "").trim();
}

export function writeStoredLocale(value = "") {
  globalThis?.localStorage?.setItem?.(LOCALE_STORAGE_KEY, normalizeLocale(value));
}

function lookupKey(source = {}, key = "") {
  return String(key || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), source);
}

function applyParams(text = "", params = {}) {
  let output = String(text || "");
  for (const [key, value] of Object.entries(params || {})) {
    output = output.replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
}

export function translateMessageKey(locale = "", key = "", params = {}) {
  const table = messages[normalizeLocale(locale)] || messages[FALLBACK_LOCALE] || {};
  const fallbackTable = messages[FALLBACK_LOCALE] || {};
  const raw = lookupKey(table, key) ?? lookupKey(fallbackTable, key) ?? key;
  return applyParams(raw, params);
}

export function translateStoredLocaleMessageKey(key = "", params = {}) {
  return translateMessageKey(readStoredLocale(), key, params);
}
