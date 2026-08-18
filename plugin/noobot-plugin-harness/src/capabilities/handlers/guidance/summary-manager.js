/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./deps.js";
import { mergeSummaryText } from "../shared/plan/summary-text-protocol.js";
import { resolveLatestCompleteSummaryText } from "../shared/plan/latest-summary-context.js";
import { mergeTransferEnvelopes, normalizeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";

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

export function shouldSaveSummaryToAttachment(meta = {}) {
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
  const runtime = ctx?.agentContext?.bindings?.runtime || null;
  const transferSemanticContent = runtime?.sharedTools?.semanticTransfer?.transferSemanticContent;
  if (typeof transferSemanticContent !== "function") {
    throw new Error("harness_semantic_transfer_runtime_required");
  }
  const transferred = await transferSemanticContent({
    scenario: "harness",
    strategy: "harness_summary",
    producer: { type: "plugin", id: "harness-summary" },
    direction: "output",
    injectMode,
    fullText,
    summaryText,
    detailText,
    meta,
  });
  const directEnvelope = (Array.isArray(transferred?.transferEnvelopes)
    ? transferred.transferEnvelopes
    : []).find((envelope = {}) => envelope?.payload?.mode === "direct");
  if (!directEnvelope || typeof directEnvelope?.payload?.content !== "string") {
    throw new Error("harness_summary_direct_transfer_required");
  }
  return directEnvelope.payload.content.trim();
}

export function resolvePreviousSummaryContextText(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  const bucket = holder?.bucket || {};
  const latestCompleteSummaryText = resolveLatestCompleteSummaryText({ bucket, ctx });
  return latestCompleteSummaryText;
}

export function recordSummaryTransferEnvelopes(ctx = {}, transferPayload = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return [];
  const { bucket } = holder;
  const envelopes = normalizeTransferEnvelopes(transferPayload?.transferEnvelopes || [])
    .filter((envelope) => envelope.payload.mode === "attachment");
  bucket.summaryTransferEnvelopes = mergeTransferEnvelopes(
    bucket.summaryTransferEnvelopes || [],
    envelopes,
  );
  return bucket.summaryTransferEnvelopes;
}
