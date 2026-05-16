/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeInteractionData(input = {}) {
  return input && typeof input === "object" ? input : {};
}

export function resolveConnectorConnectedPayload(payload = {}) {
  const interactionData = normalizeInteractionData(payload?.interactionData);
  return {
    interactionData,
    connectorType: String(
      payload?.connectorType || interactionData?.connectorType || "",
    ).trim(),
    connectorName: String(
      payload?.connectorName || interactionData?.connectorName || "",
    ).trim(),
    status: String(interactionData?.status || "connected").trim() || "connected",
  };
}

export function resolveConnectorStatusPayload(payload = {}) {
  const interactionData = normalizeInteractionData(payload?.interactionData);
  return {
    interactionData,
    connectorType: String(
      payload?.connectorType || interactionData?.connectorType || "",
    ).trim(),
    connectorName: String(
      payload?.connectorName || interactionData?.connectorName || "",
    ).trim(),
    status: String(
      payload?.status || interactionData?.status || "connected",
    ).trim() || "connected",
  };
}

export function normalizeInteractionRequestPayload(payload = {}) {
  const interactionData = normalizeInteractionData(payload?.interactionData);
  return {
    requestId: String(payload?.requestId || ""),
    content: String(payload?.content || ""),
    fields: Array.isArray(payload?.fields) ? payload.fields : [],
    dialogProcessId: String(payload?.dialogProcessId || ""),
    requireEncryption: payload?.requireEncryption === true,
    sessionId: String(payload?.sessionId || ""),
    toolName: String(payload?.toolName || ""),
    needConnectionInfo: payload?.needConnectionInfo === true,
    connectorName: String(payload?.connectorName || ""),
    connectorType: String(payload?.connectorType || ""),
    interactionType: String(payload?.interactionType || "").trim(),
    interactionData,
  };
}
