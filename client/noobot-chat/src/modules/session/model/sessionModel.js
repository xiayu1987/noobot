/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureUuid } from "../../../shared/identity/secureIdentity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { messages } from "noobot-i18n/client/messages";
import { nowIso } from "../../chat/model/timeFields.js";
import { text } from "@noobot/shared/value";

export function createConnectorPanelState(overrides = {}) {
  return {
    rootSessionId: text(overrides?.rootSessionId),
    connectors: Array.isArray(overrides?.connectors) ? overrides.connectors : [],
    selectedConnectorIds: normalizeSelectedConnectorIds(overrides?.selectedConnectorIds),
    updatedAt: nowIso(),
  };
}

function resolveDefaultSessionTitle() {
  const savedLocale = text(localStorage.getItem("noobot_locale"));
  const locale = savedLocale || "zh-CN";
  return (
    messages?.[locale]?.chat?.newSession || messages?.["zh-CN"]?.chat?.newSession || "New Session"
  );
}

export function sessionTitleFromMessages(messages = [], fallback = resolveDefaultSessionTitle()) {
  const firstUser = (Array.isArray(messages) ? messages : []).find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      text(messageItem?.role).toLowerCase() === "user" &&
      text(messageItem?.content),
  );
  return firstUser ? String(firstUser.content || "").slice(0, 20) : fallback;
}

export function generateSessionId() {
  return createSecureUuid();
}
