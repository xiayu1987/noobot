/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { pickLocaleText } from "noobot-i18n/shared";
import { BACKEND_I18N } from "noobot-i18n/agent/backend-messages";

export { resolveLocaleFromAcceptLanguage } from "noobot-i18n/shared";

export function tModelRuntime(locale, key, params) {
  return pickLocaleText({ locale, dict: BACKEND_I18N, key: `modelRuntime.${key}`, params });
}

export function modelHttpStatusFallback(locale, status) {
  const key = `modelRuntime.httpStatus.${status}`;
  return Object.hasOwn(BACKEND_I18N, key)
    ? pickLocaleText({ locale, dict: BACKEND_I18N, key })
    : "";
}
