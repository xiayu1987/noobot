/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureUuid } from "../../../shared/identity/secureIdentity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { messages } from "noobot-i18n/client/messages";
import { nowIso } from "../../chat/model/timeFields.js";

export function createConnectorPanelState(overrides = {}) {
  return {
    rootSessionId: String(overrides?.rootSessionId || "").trim(),
    connectors: Array.isArray(overrides?.connectors) ? overrides.connectors : [],
    selectedConnectorIds: normalizeSelectedConnectorIds(overrides?.selectedConnectorIds),
    updatedAt: nowIso(),
  };
}

function resolveDefaultSessionTitle() {
  const savedLocale = String(localStorage.getItem("noobot_locale") || "").trim();
  const locale = savedLocale || "zh-CN";
  return (
    messages?.[locale]?.chat?.newSession || messages?.["zh-CN"]?.chat?.newSession || "New Session"
  );
}

export function sessionTitleFromMessages(messages = [], fallback = resolveDefaultSessionTitle()) {
  const firstUser = (Array.isArray(messages) ? messages : []).find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "")
        .trim()
        .toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  return firstUser ? String(firstUser.content || "").slice(0, 20) : fallback;
}

export function generateSessionId() {
  return createSecureUuid();
}
