/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BACKEND_I18N } from "./backend-messages.js";
import { DEFAULT_LOCALE, normalizeLocale, pickLocaleText } from "../shared/index.js";
import { text } from "@noobot/shared/value";

function resolveLocaleFromEnv() {
  const lang = text(process.env.NOOBOT_LANG || process.env.LANG);
  return normalizeLocale(lang, DEFAULT_LOCALE);
}

export function tSystem(key = "", locale = "", fallback = "") {
  return pickLocaleText({
    locale: normalizeLocale(locale || resolveLocaleFromEnv(), DEFAULT_LOCALE),
    dict: BACKEND_I18N,
    key,
    fallback,
    fallbackLocale: DEFAULT_LOCALE,
  });
}
