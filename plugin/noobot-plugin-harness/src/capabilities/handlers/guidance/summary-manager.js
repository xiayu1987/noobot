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

function resolveAttachmentPath(meta = {}) {
  const relativePath = String(meta?.relativePath || "").trim();
  if (relativePath) return relativePath;
  const path = String(meta?.path || "").trim();
  if (path) return path;
  return String(meta?.name || "").trim();
}

export function recordSummaryDetailAttachmentMetas(ctx = {}, metas = []) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return [];
  const { bucket } = holder;
  const source = Array.isArray(metas) ? metas : [];
  if (!Array.isArray(bucket.summaryDetailAttachmentMetas)) {
    bucket.summaryDetailAttachmentMetas = [];
  }
  const keyOf = (item = {}) =>
    String(item?.attachmentId || "").trim() ||
    `${String(item?.name || "").trim()}|${String(item?.path || "").trim()}`;
  const seen = new Set(bucket.summaryDetailAttachmentMetas.map((item = {}) => keyOf(item)).filter(Boolean));
  for (const item of source) {
    const key = keyOf(item);
    if (key && seen.has(key)) continue;
    bucket.summaryDetailAttachmentMetas.push(item);
    if (key) seen.add(key);
  }
  bucket.summaryDetailPaths = bucket.summaryDetailAttachmentMetas
    .map((item = {}) => resolveAttachmentPath(item))
    .filter(Boolean);
  return bucket.summaryDetailPaths;
}
