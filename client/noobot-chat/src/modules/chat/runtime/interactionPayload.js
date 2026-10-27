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
import { text, isObjectLike, isCanonicalText } from "@noobot/shared/value";

function normalizeInteractionData(input = {}) {
  return input && typeof input === "object" ? input : {};
}

function normalizeInteractionNotification(input = {}) {
  if (!isObjectLike(input)) {
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

export function normalizeInteractionRequestPayload(payload, { channelSessionId }) {
  if (!isCanonicalText(channelSessionId)) {
    throw new TypeError("interaction request requires channelSessionId");
  }
  if (!isCanonicalText(payload.requestId)) {
    throw new TypeError("interaction request requires requestId");
  }
  const interactionData = normalizeInteractionData(payload?.interactionData);
  const lifecycle = normalizeInteractionLifecycle(payload?.lifecycle);
  const resolvedBy = normalizeInteractionResolvedBy(payload?.resolvedBy);
  const notification = normalizeInteractionNotification(payload?.notification);
  return {
    requestId: payload.requestId,
    content: String(payload?.content || ""),
    fields: Array.isArray(payload?.fields) ? payload.fields : [],
    dialogProcessId: payload.dialogProcessId,
    requireEncryption: payload?.requireEncryption === true,
    sessionId: payload.sessionId,
    turnScopeId: payload.turnScopeId,
    channelSessionId,
    toolName: String(payload?.toolName || ""),
    needConnectionInfo: payload?.needConnectionInfo === true,
    connectorName: String(payload?.connectorName || ""),
    connectorType: String(payload?.connectorType || ""),
    interactionType: text(payload?.interactionType),
    lifecycle,
    resolvedBy,
    notification,
    interactionData,
  };
}

export function reduceInteractionRequest(
  payload,
  { channelSessionId, setPendingInteractionRequest, clearPendingInteraction },
) {
  const request = normalizeInteractionRequestPayload(payload, { channelSessionId });
  if (isTerminalInteractionLifecycle(request.lifecycle)) clearPendingInteraction(request);
  else setPendingInteractionRequest(request);
  return request;
}
