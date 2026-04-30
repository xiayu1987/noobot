/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import zhCN from "./locales/zh-CN.js";
import enUS from "./locales/en-US.js";

function toBilingualDict(zhMap = {}, enMap = {}) {
  const keys = new Set([
    ...Object.keys(zhMap || {}),
    ...Object.keys(enMap || {}),
  ]);
  const output = {};
  for (const key of keys) {
    output[key] = {
      "zh-CN": String(zhMap?.[key] || "").trim(),
      "en-US": String(enMap?.[key] || zhMap?.[key] || "").trim(),
    };
  }
  return output;
}

export const BACKEND_I18N = toBilingualDict(zhCN, enUS);
