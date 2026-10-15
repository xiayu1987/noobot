/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  isTerminalInteractionLifecycle,
  normalizeInteractionLifecycle,
  normalizeInteractionResolvedBy,
} from "@noobot/event-protocol";
import { text } from "@noobot/shared/value";

function normalizeInteractionData(input = {}) {
  return input && typeof input === "object" ? input : {};
}

function normalizeInteractionAckMode(value = "") {
  const normalized = text(value).toLowerCase();
  if (["manual", "auto"].includes(normalized)) return normalized;
  return "manual";
}

function normalizeInteractionNotification(input = {}) {
  if (!input || typeof input !== "object") {
    return { enabled: false, level: "info", title: "", content: "", data: {} };
  }
  const level = text(input?.level).toLowerCase();
  return {
    enabled: input?.enabled === true,
    level: ["info", "success", "warning", "error"].includes(level) ? level : "info",
    title: text(input?.title),
    content: text(input?.content),
    data: input?.data && typeof input.data === "object" ? input.data : {},
  };
}

export function normalizeInteractionRequestPayload(payload = {}, { channelSessionId = "" } = {}) {
  const interactionData = normalizeInteractionData(payload?.interactionData);
  const lifecycle = normalizeInteractionLifecycle(payload?.lifecycle);
  const ackMode = normalizeInteractionAckMode(payload?.ackMode);
  const resolvedBy = normalizeInteractionResolvedBy(payload?.resolvedBy);
  const notification = normalizeInteractionNotification(payload?.notification);
  return {
    requestId: String(payload?.requestId || ""),
    content: String(payload?.content || ""),
    fields: Array.isArray(payload?.fields) ? payload.fields : [],
    dialogProcessId: String(payload?.dialogProcessId || ""),
    requireEncryption: payload?.requireEncryption === true,
    sessionId: String(payload?.sessionId || ""),
    turnScopeId: String(payload?.turnScopeId || ""),
    channelSessionId: text(channelSessionId),
    toolName: String(payload?.toolName || ""),
    needConnectionInfo: payload?.needConnectionInfo === true,
    connectorName: String(payload?.connectorName || ""),
    connectorType: String(payload?.connectorType || ""),
    interactionType: text(payload?.interactionType),
    lifecycle,
    ackMode,
    resolvedBy,
    notification,
    interactionData,
  };
}

export function isAutoResolvedInteraction(payload = {}) {
  const request = normalizeInteractionRequestPayload(payload);
  return request.lifecycle === "resolved" && request.ackMode === "auto";
}

export function isTerminalInteraction(payload = {}) {
  const request = normalizeInteractionRequestPayload(payload);
  return isTerminalInteractionLifecycle(request.lifecycle);
}
