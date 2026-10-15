/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function createRequestContextService({
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  defaultLocale,
  i18nDict,
} = {}) {
  function resolveRequestLocale(req = {}, fallbackLocale = defaultLocale) {
    const headerLocale = text(req?.headers?.["x-noobot-locale"]);
    if (headerLocale) return normalizeLocale(headerLocale);
    const queryLocale = text(req?.query?.locale);
    if (queryLocale) return normalizeLocale(queryLocale);
    const bodyLocale = text(req?.body?.locale);
    if (bodyLocale) return normalizeLocale(bodyLocale);
    const acceptLanguage = text(req?.headers?.["accept-language"]);
    if (acceptLanguage) return resolveLocaleFromAcceptLanguage(acceptLanguage);
    return normalizeLocale(fallbackLocale);
  }

  function translateText(key = "", locale = defaultLocale, params = {}) {
    return pickLocaleText({
      locale,
      dict: i18nDict,
      key,
      fallbackLocale: defaultLocale,
      params,
    });
  }

  return {
    resolveRequestLocale,
    translateText,
  };
}
