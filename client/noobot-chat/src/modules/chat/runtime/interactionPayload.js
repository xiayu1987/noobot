/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeInteractionData(input = {}) {
  return input && typeof input === "object" ? input : {};
}

function normalizeInteractionLifecycle(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "pending";
  if (["pending", "resolved", "failed"].includes(normalized)) return normalized;
  return "pending";
}

function normalizeInteractionAckMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["manual", "auto"].includes(normalized)) return normalized;
  return "manual";
}

function normalizeInteractionResolvedBy(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["user", "system", "auto"].includes(normalized)) return normalized;
  return "";
}

function normalizeInteractionNotification(input = {}) {
  if (!input || typeof input !== "object") {
    return { enabled: false, level: "info", title: "", content: "", data: {} };
  }
  const level = String(input?.level || "").trim().toLowerCase();
  return {
    enabled: input?.enabled === true,
    level: ["info", "success", "warning", "error"].includes(level) ? level : "info",
    title: String(input?.title || "").trim(),
    content: String(input?.content || "").trim(),
    data: input?.data && typeof input.data === "object" ? input.data : {},
  };
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
  const lifecycle = normalizeInteractionLifecycle(
    payload?.lifecycle || interactionData?.lifecycle || "",
  );
  const ackMode = normalizeInteractionAckMode(
    payload?.ackMode ||
      payload?.ack_mode ||
      interactionData?.ackMode ||
      interactionData?.ack_mode ||
      "",
  );
  const resolvedBy = normalizeInteractionResolvedBy(
    payload?.resolvedBy ||
      payload?.resolved_by ||
      interactionData?.resolvedBy ||
      interactionData?.resolved_by ||
      "",
  );
  const notification = normalizeInteractionNotification(
    payload?.notification || interactionData?.notification || {},
  );
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
