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
    const zhValue = zhMap?.[key];
    const enValue = enMap?.[key];
    output[key] = {
      "zh-CN":
        typeof zhValue === "function" ? zhValue : String(zhValue || "").trim(),
      "en-US":
        typeof enValue === "function"
          ? enValue
          : String(enValue ?? zhValue ?? "").trim(),
    };
  }
  return output;
}

export const BACKEND_I18N = toBilingualDict(zhCN, enUS);
