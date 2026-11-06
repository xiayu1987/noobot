/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickLocaleText, resolveLocaleFromRuntime } from "noobot-i18n/shared";
import { BACKEND_I18N } from "noobot-i18n/agent/backend-messages";
import { requireToolNameBinding } from "@noobot/model-protocol/tool-binding-scope-node";

export function resolveToolLocale(runtime = {}) {
  return resolveLocaleFromRuntime(runtime);
}

export function tToolForLocale(locale = "", key = "", params = {}, transformText) {
  return pickLocaleText({
    locale,
    dict: BACKEND_I18N,
    key,
    fallbackLocale: "zh-CN",
    params,
    transformText,
  });
}

export function tTool(runtime = {}, key = "", params = {}) {
  return tToolForLocale(resolveToolLocale(runtime), key, params, (template) => {
    if (!template.includes("{{tool:")) return template;
    return requireToolNameBinding().renderReferences(template);
  });
}

export function tToolTemplate(runtime = {}, key = "", params = {}) {
  return tToolForLocale(resolveToolLocale(runtime), key, params);
}
