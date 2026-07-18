/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs } from "../../../config/index.js";
import { browserLikeFetch } from "../../../utils/web/fetch.js";
import { normalizeText } from "../../../utils/shared-utils.js";
import { tTool } from "../../core/tool-i18n.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
const MAX_BATCH_BYTES = LENGTH_THRESHOLDS.dataProcessing.batchBytes;
const MAX_TEXT_CHARS = LENGTH_THRESHOLDS.dataProcessing.webTextChars;

export function sanitizeArtifactBaseName(input = "", fallback = "web2data_result") {
  const normalized = String(input || "").trim();
  if (!normalized) return fallback;
  return normalized.replace(/[^\w.-]+/g, "_");
}
export const BROWSER_RETRY_COUNT = TURN_THRESHOLDS.web.browserRetryCount;
export const DEFAULT_CONCURRENCY = QUANTITY_THRESHOLDS.web.defaultConcurrency;
const MAX_CONCURRENCY = QUANTITY_THRESHOLDS.web.maxConcurrency;
export const BROWSER_SIMULATE_TIMEOUT_MS = normalizeTimeMs(45000, {
  fallback: 45000,
  min: 1000,
});
export const BROWSER_SIMULATE_NETWORK_IDLE_TIMEOUT_MS = normalizeTimeMs(10000, {
  fallback: 10000,
  min: 500,
});

export function tWeb(runtime = {}, key = "", params = {}) {
  const normalizedKey = String(key || "").trim();
  const commonKeyMap = {
    runtimeBasePathMissing: "common.runtimeBasePathMissing",
    noProcessableUrl: "common.noProcessableUrl",
  };
  const i18nKey =
    commonKeyMap[normalizedKey] || `tools.web2data.${normalizedKey}`;
  return tTool(runtime, i18nKey, params);
}


export function isUrl(input = "") {
  return /^https?:\/\//i.test(String(input || "").trim());
}

export function looksBlockedPage({ status = 0, title = "", html = "", text = "" }) {
  if (Number(status) >= 500) return true;
  const normalizedTitle = normalizeText(title).toLowerCase();
  const normalizedText = String(text || "").toLowerCase();
  const leadingTextSample = normalizedText.slice(0, LENGTH_THRESHOLDS.dataProcessing.webLeadingTextSampleChars);
  const titleOrTextSample = `${normalizedTitle}\n${leadingTextSample}`;
  const strongPatterns = [
    "503 service temporarily unavailable",
    "service temporarily unavailable",
    "openresty",
    "access denied",
    "403 forbidden",
    "verification required",
    "robot check",
    "安全验证",
    "访问受限",
    "请求过于频繁",
  ];
  if (strongPatterns.some((patternText) => titleOrTextSample.includes(patternText))) {
    return true;
  }

  // “captcha” 在很多正常页面的脚本配置里会出现，不应单独作为拦截信号
  const hasCaptchaSignal = /captcha|hcaptcha|recaptcha/i.test(
    `${normalizedTitle}\n${leadingTextSample}`,
  );
  const hasChallengeSignal = /verification required|robot check|安全验证|请完成验证|访问受限/i.test(
    `${normalizedTitle}\n${leadingTextSample}`,
  );
  if (hasCaptchaSignal && hasChallengeSignal) return true;

  // 仅在正文很短且包含拦截特征时，才用 html 兜底判定
  if (leadingTextSample.length < 500) {
    const normalizedHtml = String(html || "")
      .toLowerCase()
      .slice(0, LENGTH_THRESHOLDS.dataProcessing.webHtmlProbeChars);
    if (
      /openresty|access denied|403 forbidden|service temporarily unavailable/.test(
        normalizedHtml,
      )
    ) {
      return true;
    }
  }

  return false;
}

export function normalizeProcessMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "multimodal") return "multimodal";
  if (
    mode === "browser_simulate" ||
    mode === "browser-simulate" ||
    mode === "browser"
  ) {
    return "browser_simulate";
  }
  return "direct";
}

export function toModelText(content) {
  return typeof content === "string" ? content : JSON.stringify(content || "");
}

export function truncateText(input = "", maxChars = MAX_TEXT_CHARS, runtime = {}) {
  const text = String(input || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n${tWeb(runtime, "truncated")}`;
}

export function uniqueUrls(urls = []) {
  return Array.from(
    new Set(
      (urls || [])
        .map((urlValue) => String(urlValue || "").trim())
        .filter((urlValue) => isUrl(urlValue)),
    ),
  );
}

export function normalizeConcurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(num)));
}

export function resolveFetcher(runtime = {}) {
  const contextFetcher = runtime?.sharedTools?.fetch;
  return typeof contextFetcher === "function" ? contextFetcher : browserLikeFetch;
}

export async function mapWithConcurrency(items = [], worker, concurrency = DEFAULT_CONCURRENCY) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const size = normalizeConcurrency(concurrency);
  const results = new Array(list.length);
  let cursor = 0;
  async function runOne() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(size, list.length) }, () =>
    runOne(),
  );
  await Promise.all(workers);
  return results;
}
