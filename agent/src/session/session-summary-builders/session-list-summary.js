/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildMessageSummary } from "./message-summary-projection.js";

export const SESSIONS_SUMMARY_SCHEMA_VERSION = 2;

export function buildSessionSummary(session = {}, { depth = 0 } = {}) {
  const sessionId = String(session?.sessionId || "").trim();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      String(messageItem?.role || "")
        .trim()
        .toLowerCase() === "user" &&
      String(messageItem?.content || "").trim(),
  );
  const lastMessage = messages.length ? buildMessageSummary(messages[messages.length - 1]) : null;
  const customTitle = String(session?.customTitle || "").trim();
  return {
    sessionId,
    parentSessionId: String(session?.parentSessionId || "").trim(),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: String(session?.currentTaskId || "").trim(),
    createdAt: String(session?.createdAt || "").trim(),
    updatedAt: String(session?.updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    title:
      customTitle ||
      (firstUserMessage
        ? String(firstUserMessage.content || "").slice(0, 20)
        : sessionId.slice(0, 8)),
    messageCount: messages.length,
    lastMessage,
    availability: "available",
  };
}

export function buildUnavailableSessionSummary({
  sessionId = "",
  parentSessionId = "",
  title = "",
  caller = "user",
  createdAt = "",
  updatedAt = "",
  errorCode = "SESSION_PROTOCOL_INVALID",
  reason = "",
  depth = 0,
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  return {
    sessionId: normalizedSessionId,
    parentSessionId: String(parentSessionId || "").trim(),
    caller: String(caller || "user").trim() || "user",
    currentTaskId: "",
    createdAt: String(createdAt || "").trim(),
    updatedAt: String(updatedAt || "").trim(),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    aggregateVersion: 0,
    title: String(title || "").trim() || normalizedSessionId.slice(0, 8),
    messages: [],
    messageCount: 0,
    lastMessage: null,
    availability: "unavailable",
    unavailableReason: {
      code: String(errorCode || "SESSION_PROTOCOL_INVALID").trim() || "SESSION_PROTOCOL_INVALID",
      message: String(reason || "Session uses an unsupported protocol").trim(),
    },
  };
}

export function normalizeSessionsSummaryPayload(
  payload = {},
  now = () => new Date().toISOString(),
) {
  const source = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const sessions = source
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      sessionId: String(item?.sessionId || "").trim(),
      parentSessionId: String(item?.parentSessionId || "").trim(),
      caller: String(item?.caller || "user").trim() || "user",
      currentTaskId: String(item?.currentTaskId || "").trim(),
      createdAt: String(item?.createdAt || "").trim(),
      updatedAt: String(item?.updatedAt || "").trim(),
      depth: Number.isFinite(Number(item?.depth)) ? Number(item.depth) : 0,
      aggregateVersion: Math.max(0, Number(item?.aggregateVersion) || 0),
      title:
        String(item?.title || "").trim() ||
        String(item?.sessionId || "")
          .trim()
          .slice(0, 8),
      messageCount: Number.isFinite(Number(item?.messageCount)) ? Number(item.messageCount) : 0,
      lastMessage:
        item?.lastMessage &&
        typeof item.lastMessage === "object" &&
        !Array.isArray(item.lastMessage)
          ? item.lastMessage
          : null,
      ...(item?.availability === "unavailable" ? { messages: [] } : {}),
      availability: item?.availability === "unavailable" ? "unavailable" : "available",
      ...(item?.availability === "unavailable"
        ? {
            unavailableReason: {
              code: String(item?.unavailableReason?.code || "SESSION_PROTOCOL_INVALID").trim(),
              message: String(
                item?.unavailableReason?.message || "Session uses an unsupported protocol",
              ).trim(),
            },
          }
        : {}),
    }))
    .filter((item) => item.sessionId);
  return {
    schemaVersion: SESSIONS_SUMMARY_SCHEMA_VERSION,
    sessions,
    updatedAt: String(payload?.updatedAt || "").trim() || now(),
  };
}
