/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./deps.js";
import { mergeSummaryText } from "../shared/plan/summary-text-protocol.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";

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

export function recordLatestSummaryFullText(ctx = {}, summaryFullText = "") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return "";
  const { bucket } = holder;
  const text = String(summaryFullText || "").trim();
  if (!text) return String(bucket?.summaryFullText || "").trim();
  bucket.summaryFullText = text;
  return bucket.summaryFullText;
}

export function shouldSaveSummaryDetailToAttachment(meta = {}) {
  return (
    meta?.harness?.summaryDetailSaveToAttachment === true ||
    meta?.harness?.saveSummaryDetailToAttachment === true
  );
}

export async function transferSummaryInjectionMessage(
  ctx = {},
  {
    fullText = "",
    summaryText = "",
    detailText = "",
    injectMode = "full",
    meta = {},
  } = {},
) {
  const runtime = ctx?.agentContext?.execution?.controllers?.runtime || null;
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  const fallback = String(
    String(injectMode || "").trim().toLowerCase() === "summary"
      ? summaryText || fullText
      : fullText || summaryText
  ).trim();
  if (typeof transferSemanticContent !== "function") return fallback;
  try {
    const transferred = await transferSemanticContent({
      scenario: "harness",
      strategy: "harness_summary_injection",
      injectMode,
      fullText,
      summaryText,
      detailText,
      meta,
    });
    return String(transferred?.injectionMessage || fallback).trim();
  } catch {
    return fallback;
  }
}

export function resolvePreviousSummaryContextText(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  const bucket = holder?.bucket || {};
  const latestCompleteSummaryText = resolveLatestCompleteSummaryText({ bucket, ctx });
  const paths = Array.isArray(bucket?.summaryDetailPaths)
    ? bucket.summaryDetailPaths.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const pathBlock = paths.length
    ? ["SUMMARY_DETAIL_PATHS:", ...paths.map((item) => `- ${item}`)].join("\n")
    : "";
  return [latestCompleteSummaryText, pathBlock]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function resolveAttachmentPath(meta = {}, ctx = {}) {
  return resolveAttachmentDisplayPath(meta, ctx);
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
    .map((item = {}) => resolveAttachmentPath(item, ctx))
    .filter(Boolean);
  return bucket.summaryDetailPaths;
}
