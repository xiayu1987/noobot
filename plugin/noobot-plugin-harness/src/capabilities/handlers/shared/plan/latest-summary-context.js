/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { resolveModelMessageBlocks, resolveModelMessages } from "../../../../core/message-store.js";
import { readContextMessageField } from "@noobot/context-protocol/message/codec";
import { text } from "@noobot/shared/value";

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
  const injectedType = readContextMessageField(message, "injectedMessageType");
  if (injectedType === "separate_model_relay:summary") return true;
  const content = text(message?.content ?? message?.lc_kwargs?.content);
  return new RegExp(`^${resolveSummaryRelayPrefixPattern()}`, "i").test(content);
}

export function resolveLatestSummaryRelayText(ctx = {}) {
  const candidates = [...resolveModelMessages(ctx), ...resolveModelMessageBlocks(ctx).history];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index] || {};
    if (!isSummaryRelayMessage(message)) continue;
    const inputText = stripSummaryRelayPrefix(
      message?.content ?? message?.lc_kwargs?.content ?? "",
    );
    if (inputText) return inputText;
  }
  return "";
}

export function resolveLatestSummaryOutputFullText(bucket = {}) {
  const outputs = Array.isArray(bucket?.guidanceOutputs) ? bucket.guidanceOutputs : [];
  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const item = outputs[index] || {};
    if (text(item?.purpose) !== "summary") continue;
    const content = text(item?.content);
    if (content) return content;
  }
  return "";
}

export function resolveLatestCompleteSummaryText({ bucket = {}, ctx = {} } = {}) {
  const fullText = text(bucket?.summaryFullText);
  if (fullText) return fullText;
  const outputFullText = resolveLatestSummaryOutputFullText(bucket);
  if (outputFullText) return outputFullText;
  const relayText = resolveLatestSummaryRelayText(ctx);
  if (relayText) return relayText;
  return text(bucket?.summaryText);
}
