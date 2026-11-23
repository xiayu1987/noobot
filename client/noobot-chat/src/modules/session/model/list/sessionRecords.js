/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../../chat/model/timeFields.js";
import { isNewerSessionAggregateVersion } from "../../../chat/runtime/engine/sessionAggregateVersionManager.js";
import { ROOT_PARENT_SESSION_ID } from "@noobot/agent-transport-protocol";
import {
  SESSION_SUMMARY_AVAILABILITY,
  requireSessionSummaryEntry,
} from "@noobot/session-protocol/sessions-summary";
import {
  isAvailableSessionDetailEntry,
  isSessionDetailEntryCurrent,
  requireSessionDetailDocument,
  requireSessionDetailEntry,
} from "@noobot/session-protocol/session-detail";

export function createLocalSessionItem({ id, title, createConnectorPanelState }) {
  const createdAt = nowIso();
  return {
    sessionId: id,
    parentSessionId: ROOT_PARENT_SESSION_ID,
    availability: SESSION_SUMMARY_AVAILABILITY.AVAILABLE,
    isUnavailable: false,
    title,
    isLocal: true,
    loaded: true,
    aggregateVersion: 0,
    knownGeneration: null,
    messageCount: 0,
    messages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
    createdAt,
    updatedAt: createdAt,
  };
}

function createRemoteSessionItem(entry, createConnectorPanelState) {
  return {
    sessionId: entry.sessionId,
    parentSessionId: entry.parentSessionId,
    caller: entry.caller,
    availability: entry.availability,
    isUnavailable: entry.availability === SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE,
    isLocal: false,
    loaded: false,
    knownGeneration: null,
    messages: [],
    sessionDocs: [],
    connectorPanelState: createConnectorPanelState(),
  };
}

function createUnavailableSessionItem(entry, createConnectorPanelState) {
  return {
    ...createRemoteSessionItem(entry, createConnectorPanelState),
    unavailableReason: entry.unavailableReason,
  };
}

function createAvailableSessionItem(entry, createConnectorPanelState) {
  return {
    ...createRemoteSessionItem(entry, createConnectorPanelState),
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    aggregateVersion: entry.aggregateVersion,
  };
}

export function mapSummaryEntryToSession(entry, { createConnectorPanelState }) {
  const summary = requireSessionSummaryEntry(entry);
  if (summary.availability === SESSION_SUMMARY_AVAILABILITY.UNAVAILABLE) {
    return createUnavailableSessionItem(summary, createConnectorPanelState);
  }
  return {
    ...createAvailableSessionItem(summary, createConnectorPanelState),
    messageCount: summary.messageCount,
  };
}

export function mapDetailEntryToSession(entry, { createConnectorPanelState }) {
  const detailEntry = requireSessionDetailEntry(entry);
  if (!isAvailableSessionDetailEntry(detailEntry)) {
    throw new TypeError("available detail required to create a session item");
  }
  return {
    ...createAvailableSessionItem(detailEntry, createConnectorPanelState),
    knownGeneration: detailEntry.generation,
  };
}

function mergeExistingSessionState(mappedSession, existingSession) {
  if (mappedSession.isUnavailable) return mappedSession;
  const loaded = isLoadedRemoteSession(existingSession);
  return {
    ...mappedSession,
    aggregateVersion: isNewerSessionAggregateVersion(
      mappedSession.aggregateVersion,
      existingSession.aggregateVersion,
    )
      ? mappedSession.aggregateVersion
      : existingSession.aggregateVersion,
    loaded,
    knownGeneration: existingSession.knownGeneration,
    messages: existingSession.messages,
    sessionDocs: existingSession.sessionDocs,
    connectorPanelState: existingSession.connectorPanelState,
    messageCount: loaded ? existingSession.messageCount : mappedSession.messageCount,
  };
}

export function reconcileSessionObject(mappedSession, existingSession) {
  if (!existingSession || existingSession.availability !== mappedSession.availability) {
    return mappedSession;
  }
  return Object.assign(existingSession, mergeExistingSessionState(mappedSession, existingSession));
}

export function isLoadedRemoteSession(sessionItem) {
  return sessionItem.isLocal !== true && sessionItem.loaded === true;
}

export function findAppliedSessionDetailEntry(sessionItem) {
  if (!Array.isArray(sessionItem.sessionDocs)) {
    throw new TypeError(`session requires sessionDocs: ${sessionItem.sessionId}`);
  }
  return sessionItem.sessionDocs.find((entry) => entry.sessionId === sessionItem.sessionId);
}

export function hasCurrentSessionDetail(sessionItem) {
  return (
    isLoadedRemoteSession(sessionItem) &&
    isSessionDetailEntryCurrent(findAppliedSessionDetailEntry(sessionItem), sessionItem)
  );
}

export function requireLoadedSessionDetail(sessionItem) {
  if (!hasCurrentSessionDetail(sessionItem)) {
    throw new TypeError(`current remote session detail required: ${sessionItem.sessionId}`);
  }
  return requireSessionDetailDocument({
    exists: true,
    sessionId: sessionItem.sessionId,
    sessions: sessionItem.sessionDocs,
  });
}

export function revokeMessagePreviewUrls(messages) {
  for (const messageItem of messages) {
    for (const attachmentItem of messageItem.attachments) {
      if (attachmentItem.previewUrl) URL.revokeObjectURL(attachmentItem.previewUrl);
    }
  }
}
