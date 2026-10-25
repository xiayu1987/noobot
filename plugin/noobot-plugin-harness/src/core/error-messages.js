/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { HARNESS_I18N_KEYSET, I18N_TEXT, LOCALE } from "../i18n.js";

export const HARNESS_CORE_ERROR = HARNESS_I18N_KEYSET.CORE_ERROR;

function normalizeLocale(input = "") {
  return text(input).toLowerCase().startsWith("en") ? LOCALE.EN_US : LOCALE.ZH_CN;
}

export function formatHarnessCoreError(key, { locale = LOCALE.EN_US, params = {} } = {}) {
  const template = I18N_TEXT[normalizeLocale(locale)][key];
  if (!template) throw new TypeError(`unknown harness core error: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}
