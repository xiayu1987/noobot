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
  summarizeSubSessionMessage,
} from "./subSessionSnapshotMerge.js";
import { createEmptySubSession } from "./subSessionRegistry.js";

export function createSubSessionSnapshotReducer({
  subSessionMessageRegistry,
  subSessionMessageRegistryVersion,
  applyTurnLifecycleSnapshot,
  applyTurnTimingSnapshot,
}) {
  return function reduceSubSessionSnapshot(snapshot) {
    const { sessionId } = snapshot;
    const registry = subSessionMessageRegistry.value;
    const current = registry.sessions[sessionId] || createEmptySubSession(sessionId);
    const admission = evaluateSubSessionSnapshotAdmission({
      snapshot,
      current,
      applyTurnLifecycleSnapshot,
      applyTurnTimingSnapshot,
    });
    if (!admission.admitted) return admission.result;
    const { lifecycleResult, timingResult, appliedAggregateVersion } = admission;
    const contextFacet = buildSnapshotContextFacet(snapshot);
    const snapshotMessages = snapshot.messages;
    const realtimeMessages = current.messages;
    logWorkflowDiagnostics("frontend.workflowSubSession.snapshotMergeStarted", () => ({
      sessionId,
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
      previousAggregateVersion: appliedAggregateVersion,
      ...contextFacet,
      messageCount: deduplicatedMessages.length,
      messages: deduplicatedMessages.map(summarizeSubSessionMessage),
    }));
    const session = buildSubSessionSnapshotRegistryEntry({
      current,
      snapshot,
      messages: deduplicatedMessages,
    });
    subSessionMessageRegistry.value = {
      ...registry,
      sessions: { ...registry.sessions, [sessionId]: session },
    };
    subSessionMessageRegistryVersion.value += 1;
    return { applied: true, session, lifecycleResult, timingResult };
  };
}
