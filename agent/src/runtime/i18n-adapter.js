/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickLocaleText, resolveLocaleFromRuntime } from "noobot-i18n/shared";
import { BACKEND_I18N } from "noobot-i18n/agent/backend-messages";
import { ENGINE_I18N_KEY_MAP } from "./constants/index.js";

export function tEngine(runtime = {}, key = "", params = {}) {
  const locale = resolveLocaleFromRuntime(runtime);
  const mappedKey = String(
    ENGINE_I18N_KEY_MAP[String(key || "").trim()] || key || "",
  ).trim();
  return pickLocaleText({ locale, dict: BACKEND_I18N, key: mappedKey, params });
}
