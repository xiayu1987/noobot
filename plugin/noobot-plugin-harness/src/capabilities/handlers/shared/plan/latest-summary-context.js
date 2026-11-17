/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { HARNESS_I18N_KEYSET, translateI18nText } from "../i18n.js";
import { resolveModelMessageBlocks } from "../../../../core/message-store.js";
import {
  readContextMessageField,
  resolveContextMessageContent,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/message/injected-types";

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
  return injectedType === CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT;
}

function resolveLatestSummaryRelayText(ctx = {}) {
  const { history, incremental } = resolveModelMessageBlocks(ctx);
  const candidates = [...history, ...incremental];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index] || {};
    if (!isSummaryRelayMessage(message)) continue;
    const inputText = stripSummaryRelayPrefix(resolveContextMessageContent(message));
    if (inputText) return inputText;
  }
  return "";
}

export function resolveLatestCompleteSummaryText({ ctx } = {}) {
  return resolveLatestSummaryRelayText(ctx);
}
