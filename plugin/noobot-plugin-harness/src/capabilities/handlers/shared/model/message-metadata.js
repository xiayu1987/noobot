/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HARNESS_MESSAGE_ORIGIN_FIELD = "harnessMessageOrigin";

export const MESSAGE_ORIGIN_KIND = Object.freeze({
  CONTEXT: "context",
  PROTOCOL: "protocol",
});

export const INTERNAL_MESSAGE_FIELDS = [
  HARNESS_MESSAGE_ORIGIN_FIELD,
];

export function readMessageField(message = {}, field = "") {
  const key = String(field || "").trim();
  if (!key) return "";
  return String(
    message?.[key] ||
      message?.additional_kwargs?.[key] ||
      message?.lc_kwargs?.[key] ||
      message?.lc_kwargs?.additional_kwargs?.[key] ||
      "",
  ).trim();
}

export function assignInternalMessageField(message = {}, field = "", value = null) {
  if (!message || typeof message !== "object" || !field || value === undefined || value === null) {
    return message;
  }
  Object.defineProperty(message, field, {
    value,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return message;
}

export function resolveRawMessageSourceId(message = {}) {
  return readMessageField(message, "noobotMessageId") || readMessageField(message, "messageId");
}

export function normalizeMessageOrigin(origin = null) {
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) return null;
  const kind = String(origin.kind || "").trim();
  const key = String(origin.key || "").trim();
  if (!kind || !key) return null;
  if (!Object.values(MESSAGE_ORIGIN_KIND).includes(kind)) return null;
  return {
    kind,
    key,
  };
}

export function resolveMessageOrigin(message = {}) {
  return normalizeMessageOrigin(message?.[HARNESS_MESSAGE_ORIGIN_FIELD]);
}

export function markMessageOrigin(message = {}, origin = null) {
  const normalizedOrigin = normalizeMessageOrigin(origin);
  if (!normalizedOrigin) return message;
  return assignInternalMessageField(message, HARNESS_MESSAGE_ORIGIN_FIELD, normalizedOrigin);
}

export function markMessageAsContext(message = {}, sourceKey = "") {
  const key = String(sourceKey || "").trim();
  if (!key) return message;
  return markMessageOrigin(message, {
    kind: MESSAGE_ORIGIN_KIND.CONTEXT,
    key,
  });
}

export function markMessageAsProtocol(message = {}, protocolKey = "") {
  const key = String(protocolKey || "").trim();
  if (!key) return message;
  return markMessageOrigin(message, {
    kind: MESSAGE_ORIGIN_KIND.PROTOCOL,
    key,
  });
}

export function buildContentOriginKey({ role = "", content = "", prefix = "" } = {}) {
  return [
    String(prefix || "content").trim() || "content",
    String(role || "").trim().toLowerCase(),
    String(content || ""),
  ].join("::");
}

export function resolveMessageOriginKey(message = {}, kind = "") {
  const origin = resolveMessageOrigin(message);
  if (!origin) return "";
  if (kind && origin.kind !== kind) return "";
  return origin.key;
}

export function isCapabilityProtocolMessage(message = {}) {
  return resolveMessageOrigin(message)?.kind === MESSAGE_ORIGIN_KIND.PROTOCOL;
}
