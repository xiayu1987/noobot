/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickLocaleText, resolveLocaleFromRuntime } from "../i18n/index.js";
import { BACKEND_I18N } from "../i18n/backend-messages.js";

export function resolveToolLocale(runtimeOrContext = {}, fallback = "zh-CN") {
  const runtime =
    runtimeOrContext?.runtime && typeof runtimeOrContext.runtime === "object"
      ? runtimeOrContext.runtime
      : runtimeOrContext;
  return resolveLocaleFromRuntime(runtime, fallback);
}

export function pickToolText({
  locale = "zh-CN",
  dict = {},
  key = "",
  fallbackLocale = "zh-CN",
  params = {},
} = {}) {
  return pickLocaleText({ locale, dict, key, fallbackLocale, params });
}

export function tTool(runtimeOrContext = {}, key = "", params = {}) {
  const locale = resolveToolLocale(runtimeOrContext);
  return pickToolText({
    locale,
    dict: BACKEND_I18N,
    key,
    fallbackLocale: "zh-CN",
    params,
  });
}
