/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./deps.js";
import { mergeSummaryText } from "../shared/plan/summary-text-protocol.js";

export function applySummaryText(ctx = {}, incomingSummaryText = "") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return "";
  const { bucket } = holder;
  const incoming = String(incomingSummaryText || "").trim();
  if (!incoming) return String(bucket?.summaryText || "").trim();
  const merged = mergeSummaryText(bucket?.summaryText || "", incoming);
  bucket.summaryText = String(merged || "").trim();
  return bucket.summaryText;
}
