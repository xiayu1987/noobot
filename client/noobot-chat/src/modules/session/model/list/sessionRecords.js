/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../../chat/model/timeFields.js";
import {
  findVisibleLastMessage,
  isPluginInjectedMessage,
} from "../../../chat/model/messageModel.js";
import { isNewerSessionAggregateVersion } from "../../../chat/runtime/engine/sessionAggregateVersionManager.js";

export function createLocalSessionItem({ id, title, createConnectorPanelState }) {
  return {
    sessionId: id,
    title,
    isLocal: true,
    loaded: true,
    aggregateVersion: 0,
    currentTaskId: "",
    messageCount: 0,
    lastMessage: null,
    messages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function mapSummaryToSession(item, { sessionTitleFromMessages, createConnectorPanelState }) {
  const isUnavailable = item?.availability === "unavailable";
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const titleFallback = item.sessionId.slice(0, 8);
  const title =
    String(item.title || "").trim() || sessionTitleFromMessages(messages, titleFallback);
  const messageCount = Number.isFinite(Number(item.messageCount))
    ? Number(item.messageCount)
    : messages.length || 0;
  const summaryLastMessage =
    item.lastMessage && typeof item.lastMessage === "object" ? item.lastMessage : null;
  const lastMessage =
    summaryLastMessage && !isPluginInjectedMessage(summaryLastMessage)
      ? summaryLastMessage
      : findVisibleLastMessage(messages);
  return {
    title,
    isLocal: false,
    loaded: isUnavailable,
    isUnavailable,
    availability: isUnavailable ? "unavailable" : "available",
    unavailableReason:
      isUnavailable && item?.unavailableReason
        ? {
            code: String(item.unavailableReason.code || ""),
            message: String(item.unavailableReason.message || ""),
          }
        : null,
    sessionId: item.sessionId,
    aggregateVersion: Number(item.aggregateVersion || 0),
    currentTaskId: item.currentTaskId || "",
    messageCount,
    lastMessage,
    messages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || "",
    caller: item.caller || "",
    depth: Number(item.depth || 0),
    turnLifecycleSnapshot:
      item.turnLifecycleSnapshot && typeof item.turnLifecycleSnapshot === "object"
        ? item.turnLifecycleSnapshot
        : null,
    turnTimings: Array.isArray(item.turnTimings) ? item.turnTimings : [],
  };
}

export function mergeExistingSessionState(
  mappedSession = {},
  existingSession = null,
  { sessionTitleFromMessages },
) {
  if (!existingSession) return mappedSession;
  const existingMessages = Array.isArray(existingSession?.messages) ? existingSession.messages : [];
  const existingSessionDocs = Array.isArray(existingSession?.sessionDocs)
    ? existingSession.sessionDocs
    : [];
  const aggregateVersion = isNewerSessionAggregateVersion(
    mappedSession.aggregateVersion,
    existingSession.aggregateVersion,
  )
    ? mappedSession.aggregateVersion
    : existingSession.aggregateVersion;
  return {
    ...mappedSession,
    aggregateVersion,
    turnLifecycleSnapshot:
      mappedSession.turnLifecycleSnapshot || existingSession.turnLifecycleSnapshot || null,
    turnTimings: mappedSession.turnTimings?.length
      ? mappedSession.turnTimings
      : Array.isArray(existingSession.turnTimings)
        ? existingSession.turnTimings
        : [],
    loaded: existingSession.loaded === true || mappedSession.loaded === true,
    isLocal: mappedSession.isLocal === false ? false : existingSession.isLocal === true,
    sessionId: mappedSession.sessionId || existingSession.sessionId,
    currentTaskId: mappedSession.currentTaskId || existingSession.currentTaskId || "",
    messages: existingMessages.length ? existingMessages : mappedSession.messages,
    sessionDocs: existingSessionDocs.length ? existingSessionDocs : mappedSession.sessionDocs,
    connectorPanelState: existingSession.connectorPanelState || mappedSession.connectorPanelState,
    messageCount: existingMessages.length || mappedSession.messageCount || 0,
    lastMessage: existingMessages.length
      ? findVisibleLastMessage(existingMessages)
      : mappedSession.lastMessage,
    title:
      String(mappedSession.title || "").trim() ||
      (existingMessages.length
        ? sessionTitleFromMessages(existingMessages, existingSession.title || mappedSession.title)
        : existingSession.title || mappedSession.title),
  };
}

export function reconcileSessionObject(mappedSession = {}, existingSession = null, options = {}) {
  const mergedSession = mergeExistingSessionState(mappedSession, existingSession, options);
  if (!existingSession) return mergedSession;
  Object.assign(existingSession, mergedSession);
  return existingSession;
}

export function revokeMessagePreviewUrls(messages = []) {
  for (const messageItem of messages) {
    const attachments = messageItem.attachments || [];
    for (const attachmentItem of attachments) {
      if (attachmentItem.previewUrl) URL.revokeObjectURL(attachmentItem.previewUrl);
    }
  }
}
