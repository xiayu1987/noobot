/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionTurnLifecycleSnapshot } from "../session-turn-read-model.js";
import { buildSessionDisplayMessages } from "./display-message-list.js";
import { buildSessionDisplayStats } from "./display-summary-stats.js";
import { attachSessionToolArtifacts } from "./display-tool-artifacts.js";

export const SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION = 25;
export const SESSION_DETAIL_MESSAGE_PROJECTION = "canonical-presentation";

export function isSessionDisplaySummaryPayload(payload = null, sessionId = "") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (Number(payload?.schemaVersion || 0) !== SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION) return false;
  const normalizedSessionId = String(sessionId || "").trim();
  if (normalizedSessionId && String(payload?.sessionId || "").trim() !== normalizedSessionId)
    return false;
  return true;
}

function text(value) {
  return String(value || "").trim();
}

function createDisplaySummaryContext(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    session,
    messages,
    turnTimings: Array.isArray(session.turnTimings) ? session.turnTimings : [],
    sessionId: text(session.sessionId),
    lifecycle:
      session.turnLifecycle && typeof session.turnLifecycle === "object"
        ? session.turnLifecycle
        : null,
  };
}

function resolveSessionTitle(session, messages, sessionId) {
  const customTitle = text(session.customTitle);
  if (customTitle) return customTitle;
  const firstUserMessage = messages.find(
    (message) =>
      message?.injectedMessage !== true &&
      text(message?.role).toLowerCase() === "user" &&
      text(message?.content),
  );
  return firstUserMessage
    ? String(firstUserMessage.content || "").slice(0, 20)
    : sessionId.slice(0, 8);
}

function buildTurnLifecycleSnapshot({ session, sessionId, lifecycle }) {
  if (!lifecycle) return null;
  return createSessionTurnLifecycleSnapshot({
    session,
    commandId: `session-summary:${sessionId}:${Number(lifecycle.sequence || 0)}`,
    generatedAt: text(session.updatedAt),
  });
}

export function buildSessionDisplaySummary(session = {}) {
  const context = createDisplaySummaryContext(session);
  const { messages, turnTimings, sessionId, lifecycle } = context;
  const displayMessages = buildSessionDisplayMessages({ messages, lifecycle, sessionId });
  const toolArtifactStats = attachSessionToolArtifacts(session, displayMessages, sessionId);
  return {
    schemaVersion: SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
    sessionId,
    parentSessionId: text(session.parentSessionId),
    caller: text(session.caller || "user") || "user",
    currentTaskId: text(session.currentTaskId),
    createdAt: text(session.createdAt),
    updatedAt: text(session.updatedAt),
    title: resolveSessionTitle(session, messages, sessionId),
    aggregateVersion: session.aggregateVersion,
    turnTimings,
    turnLifecycleSnapshot: buildTurnLifecycleSnapshot(context),
    sessionArtifactEvents: Array.isArray(session.sessionArtifactEvents)
      ? session.sessionArtifactEvents
      : [],
    messages: displayMessages,
    stats: buildSessionDisplayStats({ messages, displayMessages, ...toolArtifactStats }),
  };
}
