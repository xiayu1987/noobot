/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import {
  buildSnapshotContextFacet,
  buildSubSessionSnapshotRegistryEntry,
  evaluateSubSessionSnapshotAdmission,
} from "./subSessionSnapshotAdmission.js";
import {
  dedupeSubSessionMessagesByIdentity,
  mergeSnapshotWithRealtimeMessages,
  subSessionMessageIdentity,
  summarizeSubSessionMessage,
} from "./subSessionSnapshotMerge.js";

function text(value) {
  return String(value || "").trim();
}

export function createSubSessionSnapshotReducer({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  createEmptyRegistry,
  applyTurnLifecycleSnapshot = null,
  applyTurnTimingSnapshot = null,
}) {
  return function reduceSubSessionSnapshot(sessionDoc = {}, snapshotContext = {}) {
    const sessionId = text(sessionDoc?.sessionId);
    if (!sessionId) return { applied: false, reason: "missing_session" };
    const registry = subSessionMessageRegistry.value || createEmptyRegistry();
    const current = registry.sessions?.[sessionId] || {
      sessionId,
      messages: [],
      eventsById: {},
      sequence: 0,
    };
    const admission = evaluateSubSessionSnapshotAdmission({
      sessionId,
      sessionDoc,
      snapshotContext,
      current,
      applyTurnLifecycleSnapshot,
      applyTurnTimingSnapshot,
    });
    if (!admission.admitted) return admission.result;
    const { lifecycleResult, timingResult, aggregateVersion, appliedAggregateVersion } = admission;
    const contextFacet = buildSnapshotContextFacet(snapshotContext);
    const snapshotMessages = (
      Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : []
    ).filter((message = {}) => Boolean(subSessionMessageIdentity(message)));
    const realtimeMessages = Array.isArray(current.messages) ? current.messages : [];
    logWorkflowDiagnostics("frontend.workflowSubSession.snapshotMergeStarted", () => ({
      sessionId,
      aggregateVersion,
      appliedAggregateVersion,
      ...contextFacet,
      snapshotMessageCount: snapshotMessages.length,
      realtimeMessageCount: realtimeMessages.length,
      snapshotMessages: snapshotMessages.map(summarizeSubSessionMessage),
      realtimeMessages: realtimeMessages.map(summarizeSubSessionMessage),
    }));
    const deduplicatedMessages = dedupeSubSessionMessagesByIdentity(
      mergeSnapshotWithRealtimeMessages(snapshotMessages, realtimeMessages),
    );
    logWorkflowDiagnostics("frontend.workflowSubSession.snapshotMergeCommitted", () => ({
      sessionId,
      aggregateVersion,
      previousAggregateVersion: appliedAggregateVersion,
      ...contextFacet,
      messageCount: deduplicatedMessages.length,
      messages: deduplicatedMessages.map(summarizeSubSessionMessage),
    }));
    registry.sessions = registry.sessions || {};
    registry.sessions[sessionId] = buildSubSessionSnapshotRegistryEntry({
      current,
      sessionDoc,
      sessionId,
      messages: deduplicatedMessages,
      aggregateVersion,
    });
    subSessionMessageRegistry.value = { ...registry, sessions: { ...registry.sessions } };
    if (subSessionMessageRegistryVersion) subSessionMessageRegistryVersion.value += 1;
    return {
      applied: true,
      session: registry.sessions[sessionId],
      lifecycleResult,
      timingResult,
    };
  };
}
