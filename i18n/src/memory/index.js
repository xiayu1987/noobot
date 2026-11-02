/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DEFAULT_LOCALE, pickLocaleText } from "../shared/index.js";
import { toBilingualDict } from "../shared/bilingual-dict.js";
import zhCN from "./locales/zh-CN.js";
import enUS from "./locales/en-US.js";

const messages = toBilingualDict(zhCN, enUS);

export function tMemory(key, locale = DEFAULT_LOCALE) {
  return pickLocaleText({ key, locale, dict: messages });
}
