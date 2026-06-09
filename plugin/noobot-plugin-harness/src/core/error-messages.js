/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HARNESS_CORE_ERROR = Object.freeze({
  HOOK_MANAGER_REQUIRED: "HOOK_MANAGER_REQUIRED",
  CLEANUP_OLD_RUNS_FAILED: "CLEANUP_OLD_RUNS_FAILED",
});

function normalizeLocale(input = "") {
  const value = String(input || "").trim().toLowerCase();
  return value.startsWith("en") ? "en-US" : "zh-CN";
}

const HARNESS_CORE_ERROR_TEXT = Object.freeze({
  "zh-CN": Object.freeze({
    [HARNESS_CORE_ERROR.HOOK_MANAGER_REQUIRED]:
      "{pluginName}: \u9700\u8981\u63d0\u4f9b\u652f\u6301 .on(point, handler, options) \u7684 hookManager",
    [HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED]:
      "[harness] \u63d2\u4ef6\u6ce8\u518c\u671f\u95f4\u6e05\u7406\u5386\u53f2\u8fd0\u884c\u76ee\u5f55\u5931\u8d25: {message}",
  }),
  "en-US": Object.freeze({
    [HARNESS_CORE_ERROR.HOOK_MANAGER_REQUIRED]:
      "{pluginName}: hookManager with .on(point, handler, options) is required",
    [HARNESS_CORE_ERROR.CLEANUP_OLD_RUNS_FAILED]:
      "[harness] cleanupOldRuns failed during plugin registration: {message}",
  }),
});

export function formatHarnessCoreError(code = "", { locale = "en-US", params = {} } = {}) {
  const key = String(code || "").trim();
  if (!key) return "";
  const normalized = normalizeLocale(locale);
  const dict = HARNESS_CORE_ERROR_TEXT[normalized] || HARNESS_CORE_ERROR_TEXT["en-US"];
  const fallbackDict = HARNESS_CORE_ERROR_TEXT["en-US"];
  const template = String(dict?.[key] || fallbackDict?.[key] || "").trim();
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_all, token) => String(params?.[token] ?? ""));
}
