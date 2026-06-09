/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { useLocale } from "../../../client/noobot-chat/src/shared/i18n/useLocale";

const FALLBACK_LOCALE = "zh-CN";

const HARNESS_FRONTEND_MESSAGES = Object.freeze({
  "zh-CN": Object.freeze({
    message: Object.freeze({
      toolResultFallback: "tool_result",
      injectedSourceHarness: "harness-plugin",
      unknownShort: "unknown",
    }),
  }),
  "en-US": Object.freeze({
    message: Object.freeze({
      toolResultFallback: "tool_result",
      injectedSourceHarness: "harness-plugin",
      unknownShort: "unknown",
    }),
  }),
});

function resolvePath(source = {}, key = "") {
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

export function useHarnessLocale() {
  const { locale, translate: translateGlobal } = useLocale();

  function translate(key = "", params = {}) {
    const localTable = HARNESS_FRONTEND_MESSAGES[locale.value] || HARNESS_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const fallbackTable = HARNESS_FRONTEND_MESSAGES[FALLBACK_LOCALE] || {};
    const localHit = resolvePath(localTable, key);
    const fallbackHit = resolvePath(fallbackTable, key);
    const raw = localHit ?? fallbackHit;
    if (raw === undefined || raw === null) return translateGlobal(key, params);
    return applyParams(raw, params);
  }

  return {
    locale,
    translate,
  };
}
