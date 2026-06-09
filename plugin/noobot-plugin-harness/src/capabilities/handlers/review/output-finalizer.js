/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { HARNESS_I18N_KEYSET, LOCALE, ensureHarnessBucket, translateI18nText } from "./deps.js";

export function attachReviewReportToFinalOutput(ctx = {}, report = null) {
  if (!report) return false;
  const holder = ensureHarnessBucket(ctx);
  if (!holder || !ctx?.result || typeof ctx.result !== "object") return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const original = String(ctx.result.output || "").trim();
  ctx.result.output = [
    original,
    "",
    translateI18nText(locale, HARNESS_I18N_KEYSET.REVIEW.HEADER),
    JSON.stringify(report, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
  return true;
}
