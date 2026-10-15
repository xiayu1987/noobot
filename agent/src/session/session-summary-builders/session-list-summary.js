/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildMessageSummary } from "./message-summary-projection.js";
import { text } from "@noobot/shared/value";

export const SESSIONS_SUMMARY_SCHEMA_VERSION = 2;

export function buildSessionSummary(session = {}, { depth = 0 } = {}) {
  const sessionId = text(session?.sessionId);
  const { messages } = session;
  const firstUserMessage = messages.find(
    (messageItem) =>
      messageItem?.injectedMessage !== true &&
      text(messageItem?.role).toLowerCase() === "user" &&
      text(messageItem?.content),
  );
  const lastMessage = messages.length ? buildMessageSummary(messages[messages.length - 1]) : null;
  const customTitle = text(session?.customTitle);
  return {
    sessionId,
    parentSessionId: text(session?.parentSessionId),
    caller: String(session?.caller || "user").trim() || "user",
    currentTaskId: text(session?.currentTaskId),
    createdAt: text(session?.createdAt),
    updatedAt: text(session?.updatedAt),
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
  const normalizedSessionId = text(sessionId);
  return {
    sessionId: normalizedSessionId,
    parentSessionId: text(parentSessionId),
    caller: String(caller || "user").trim() || "user",
    currentTaskId: "",
    createdAt: text(createdAt),
    updatedAt: text(updatedAt),
    depth: Number.isFinite(Number(depth)) ? Number(depth) : 0,
    aggregateVersion: 0,
    title: text(title) || normalizedSessionId.slice(0, 8),
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
      sessionId: text(item?.sessionId),
      parentSessionId: text(item?.parentSessionId),
      caller: String(item?.caller || "user").trim() || "user",
      currentTaskId: text(item?.currentTaskId),
      createdAt: text(item?.createdAt),
      updatedAt: text(item?.updatedAt),
      depth: Number.isFinite(Number(item?.depth)) ? Number(item.depth) : 0,
      aggregateVersion: Math.max(0, Number(item?.aggregateVersion) || 0),
      title: text(item?.title) || text(item?.sessionId).slice(0, 8),
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
    updatedAt: text(payload?.updatedAt) || now(),
  };
}
