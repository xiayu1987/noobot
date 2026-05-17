/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BACKEND_I18N } from "./backend-messages.js";
import { DEFAULT_LOCALE, normalizeLocale, pickLocaleText } from "./index.js";

function resolveLocaleFromEnv() {
  const lang = String(process.env.NOOBOT_LANG || process.env.LANG || "").trim();
  return normalizeLocale(lang, DEFAULT_LOCALE);
}

export function tSystem(key = "", locale = "") {
  return pickLocaleText({
    locale: normalizeLocale(locale || resolveLocaleFromEnv(), DEFAULT_LOCALE),
    dict: BACKEND_I18N,
    key,
    fallbackLocale: DEFAULT_LOCALE,
  });
}

