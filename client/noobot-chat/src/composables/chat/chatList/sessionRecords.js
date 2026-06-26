/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../infra/timeFields";

export function createLocalSessionItem({ id, title, createConnectorPanelState }) {
  return {
    id,
    title,
    isLocal: true,
    loaded: true,
    backendSessionId: id,
    currentTaskId: "",
    currentTaskStatus: "idle",
    messageCount: 0,
    lastMessage: null,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function mapSummaryToSession(item, { sessionTitleFromMessages, createConnectorPanelState }) {
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const titleFallback = item.sessionId.slice(0, 8);
  const title = String(item.title || "").trim()
    || sessionTitleFromMessages(messages, titleFallback);
  const messageCount = Number.isFinite(Number(item.messageCount))
    ? Number(item.messageCount)
    : messages.length || 0;
  const lastMessage = item.lastMessage && typeof item.lastMessage === "object"
    ? item.lastMessage
    : messages.length
      ? messages[messages.length - 1]
      : null;
  return {
    id: item.sessionId,
    title,
    isLocal: false,
    loaded: false,
    backendSessionId: item.sessionId,
    currentTaskId: item.currentTaskId || "",
    currentTaskStatus: "idle",
    messageCount,
    lastMessage,
    messages: [],
    rawMessages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || "",
    caller: item.caller || "",
    depth: Number(item.depth || 0),
  };
}

export function mergeExistingSessionState(mappedSession = {}, existingSession = null, { sessionTitleFromMessages }) {
  if (!existingSession) return mappedSession;
  const existingMessages = Array.isArray(existingSession?.messages)
    ? existingSession.messages
    : [];
  const existingRawMessages = Array.isArray(existingSession?.rawMessages)
    ? existingSession.rawMessages
    : [];
  const existingSessionDocs = Array.isArray(existingSession?.sessionDocs)
    ? existingSession.sessionDocs
    : [];
  return {
    ...mappedSession,
    loaded: existingSession.loaded === true || mappedSession.loaded === true,
    // A server summary means this is no longer a purely local draft. Do not
    // keep isLocal=true from the optimistic object, otherwise later refreshes
    // treat the backend session as local and skip detail/replay reconciliation.
    isLocal: mappedSession.isLocal === false ? false : existingSession.isLocal === true,
    backendSessionId: mappedSession.backendSessionId || existingSession.backendSessionId,
    currentTaskId: mappedSession.currentTaskId || existingSession.currentTaskId || "",
    currentTaskStatus: mappedSession.currentTaskStatus || existingSession.currentTaskStatus || "idle",
    messages: existingMessages.length ? existingMessages : mappedSession.messages,
    rawMessages: existingRawMessages.length ? existingRawMessages : mappedSession.rawMessages,
    sessionDocs: existingSessionDocs.length ? existingSessionDocs : mappedSession.sessionDocs,
    connectorPanelState: existingSession.connectorPanelState || mappedSession.connectorPanelState,
    messageCount: existingMessages.length || mappedSession.messageCount || 0,
    lastMessage: existingMessages.length
      ? existingMessages[existingMessages.length - 1]
      : mappedSession.lastMessage,
    title: existingMessages.length
      ? sessionTitleFromMessages(existingMessages, existingSession.title || mappedSession.title)
      : mappedSession.title,
  };
}

export function reconcileSessionObject(mappedSession = {}, existingSession = null, options = {}) {
  const mergedSession = mergeExistingSessionState(mappedSession, existingSession, options);
  if (!existingSession) return mergedSession;
  // Keep the same object reference for activeSession and child props.
  // Replacing the object during replay/background refresh remounts large parts
  // of the chat UI and looks like the whole page refreshed.
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
