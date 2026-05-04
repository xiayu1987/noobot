/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createRequestContextService({
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  defaultLocale,
  i18nDict,
} = {}) {
  function resolveRequestLocale(req = {}, fallbackLocale = defaultLocale) {
    const headerLocale = String(req?.headers?.["x-noobot-locale"] || "").trim();
    if (headerLocale) return normalizeLocale(headerLocale);
    const queryLocale = String(req?.query?.locale || "").trim();
    if (queryLocale) return normalizeLocale(queryLocale);
    const bodyLocale = String(req?.body?.locale || "").trim();
    if (bodyLocale) return normalizeLocale(bodyLocale);
    const acceptLanguage = String(req?.headers?.["accept-language"] || "").trim();
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
