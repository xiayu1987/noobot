/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickLocaleText, resolveLocaleFromRuntime } from "noobot-i18n/shared";
import { BACKEND_I18N } from "noobot-i18n/agent/backend-messages";

export function resolveToolLocale(runtime = {}) {
  return resolveLocaleFromRuntime(runtime);
}

function pickToolText({
  locale = "zh-CN",
  dict = {},
  key = "",
  fallbackLocale = "zh-CN",
  params = {},
} = {}) {
  return pickLocaleText({ locale, dict, key, fallbackLocale, params });
}

export function tTool(runtime = {}, key = "", params = {}) {
  const locale = resolveToolLocale(runtime);
  return pickToolText({
    locale,
    dict: BACKEND_I18N,
    key,
    fallbackLocale: "zh-CN",
    params,
  });
}
