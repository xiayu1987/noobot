/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ensureHarnessBucket } from "./deps.js";
import { HARNESS_I18N_KEYSET, LOCALE, translateI18nText } from "./deps.js";
import { mergeSummaryText } from "../shared/plan/summary-text-protocol.js";
import { resolveAttachmentDisplayPath } from "../shared/sandbox-path.js";

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

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveSummaryRelayPrefixPattern() {
  const prefixes = [LOCALE.ZH_CN, LOCALE.EN_US]
    .map((locale) =>
      translateI18nText(locale, HARNESS_I18N_KEYSET.RELAY.SEPARATE_MODEL_PREFIX, {
        purpose: "summary",
      }),
    )
    .filter(Boolean)
    .map(escapeRegExp);
  return prefixes.length ? `(?:${prefixes.join("|")})` : "$^";
}

function stripSummaryRelayPrefix(content = "") {
  return String(content || "")
    .replace(new RegExp(`^${resolveSummaryRelayPrefixPattern()}\\s*`, "i"), "")
    .trim();
}

function isSummaryRelayMessage(message = {}) {
  const injectedType = String(
    message?.injectedMessageType ||
      message?.injected_message_type ||
      message?.lc_kwargs?.injectedMessageType ||
      message?.lc_kwargs?.injected_message_type ||
      "",
  ).trim();
  if (injectedType === "separate_model_relay:summary") return true;
  const content = String(message?.content ?? message?.lc_kwargs?.content ?? "").trim();
  return new RegExp(`^${resolveSummaryRelayPrefixPattern()}`, "i").test(content);
}

function resolveLatestSummaryRelayText(ctx = {}) {
  const candidates = [
    ...(Array.isArray(ctx?.messages) ? ctx.messages : []),
    ...(Array.isArray(ctx?.agentContext?.payload?.messages?.history)
      ? ctx.agentContext.payload.messages.history
      : []),
  ];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index] || {};
    if (!isSummaryRelayMessage(message)) continue;
    const text = stripSummaryRelayPrefix(message?.content ?? message?.lc_kwargs?.content ?? "");
    if (text) return text;
  }
  return "";
}

function resolveLatestSummaryOutputFullText(bucket = {}) {
  const outputs = Array.isArray(bucket?.guidanceOutputs) ? bucket.guidanceOutputs : [];
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const item = outputs[index] || {};
    if (String(item?.purpose || "").trim() !== "summary") continue;
    const content = String(item?.content || "").trim();
    if (content) return content;
  }
  return "";
}

export function resolvePreviousSummaryContextText(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  const bucket = holder?.bucket || {};
  const fullText = String(bucket?.summaryFullText || "").trim();
  const outputFullText = resolveLatestSummaryOutputFullText(bucket);
  const relayText = resolveLatestSummaryRelayText(ctx);
  const overviewText = String(bucket?.summaryText || "").trim();
  const paths = Array.isArray(bucket?.summaryDetailPaths)
    ? bucket.summaryDetailPaths.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const pathBlock = paths.length
    ? ["SUMMARY_DETAIL_PATHS:", ...paths.map((item) => `- ${item}`)].join("\n")
    : "";
  return [fullText || outputFullText || relayText || overviewText, pathBlock]
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
