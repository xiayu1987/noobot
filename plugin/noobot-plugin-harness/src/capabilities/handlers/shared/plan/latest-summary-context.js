/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";

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

export function resolveLatestSummaryRelayText(ctx = {}) {
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

export function resolveLatestSummaryOutputFullText(bucket = {}) {
  const outputs = Array.isArray(bucket?.guidanceOutputs) ? bucket.guidanceOutputs : [];
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const item = outputs[index] || {};
    if (String(item?.purpose || "").trim() !== "summary") continue;
    const content = String(item?.content || "").trim();
    if (content) return content;
  }
  return "";
}

export function resolveLatestCompleteSummaryText({ bucket = {}, ctx = {} } = {}) {
  const fullText = String(bucket?.summaryFullText || "").trim();
  if (fullText) return fullText;
  const outputFullText = resolveLatestSummaryOutputFullText(bucket);
  if (outputFullText) return outputFullText;
  const relayText = resolveLatestSummaryRelayText(ctx);
  if (relayText) return relayText;
  return String(bucket?.summaryText || "").trim();
}
