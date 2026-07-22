/*
 * Copyright (c) 2026 xiayu
 * SPDX-License-Identifier: MIT
 */
import {
  buildToolTimelineFromLegacyLogs,
  mergeToolTimelines,
} from "./toolTimeline";
import {
  buildActivityTimelineFromLegacyLogs,
  mergeActivityTimelines,
} from "./activityTimeline";
import { createTurnKey, resolveTurnIdentity } from "./turnIdentity";
import { createTurnObservation } from "./turnObservation";

const array = (value) => Array.isArray(value) ? value : [];

function legacyLogStream(realtimeLogs, completedLogs) {
  const realtime = array(realtimeLogs);
  return {
    logs: [...realtime, ...array(completedLogs)],
    // Persisted completedToolLogs are already classified by their storage
    // boundary. Older rows often have no event/type field, so retain that
    // classification without treating unrelated realtime activity as a tool.
    assumeTool: (_log, index) => index >= realtime.length,
  };
}

function buildLegacyToolTimeline(stream) {
  return buildToolTimelineFromLegacyLogs(stream.logs, {
    assumeTool: stream.assumeTool,
  });
}

/**
 * The only boundary allowed to understand persisted pre-timeline log fields.
 * It produces canonical, mutually exclusive timelines and deliberately omits
 * the legacy arrays so they cannot become mutable runtime facts again.
 */
export function adaptLegacyMessageTimelines(message = {}) {
  const processStream = legacyLogStream(
    message.processRealtimeLogs,
    message.processCompletedToolLogs,
  );
  const messageStream = legacyLogStream(
    message.realtimeLogs,
    message.completedToolLogs,
  );
  const processLogs = processStream.logs;
  const messageLogs = messageStream.logs;
  const processToolTimeline = buildLegacyToolTimeline(processStream);
  const messageToolTimeline = buildLegacyToolTimeline(messageStream);
  // A populated Process projection supersedes message-level tool mirrors only
  // when it actually contains tool facts. Activity-only Process rows must not
  // hide replayed message tool events.
  const selectedToolTimeline = processToolTimeline.length
    ? processToolTimeline
    : messageToolTimeline;
  const selectedStream = processToolTimeline.length ? processStream : messageStream;

  const toolTimeline = mergeToolTimelines(
    array(message.toolTimeline),
    // Build the selected realtime+completed stream once. Splitting the arrays
    // resets the index-based legacy identity and can collapse unrelated rows.
    buildLegacyToolTimeline(selectedStream),
  );
  const activityTimeline = mergeActivityTimelines(
    array(message.activityTimeline),
    buildActivityTimelineFromLegacyLogs(processLogs.length ? processLogs : messageLogs),
  );

  const {
    processRealtimeLogs: _processRealtimeLogs,
    processCompletedToolLogs: _processCompletedToolLogs,
    processExecutionLogTotal: _processExecutionLogTotal,
    realtimeLogs: _realtimeLogs,
    completedToolLogs: _completedToolLogs,
    executionLogTotal: _executionLogTotal,
    ...canonical
  } = message;
  return { ...canonical, toolTimeline, activityTimeline };
}

export function adaptLegacyMessageTimelinesObserved(message = {}) {
  const projection = adaptLegacyMessageTimelines(message);
  const identity = resolveTurnIdentity(message);
  return {
    projection,
    observation: createTurnObservation({
      requestedSessionId: identity.sessionId,
      canonicalSessionId: identity.sessionId,
      turnKey: createTurnKey(identity),
      source: "legacy_history_adapter",
      authority: "historical_read_only",
      applied: true,
      reason: "legacy_timelines_adapted",
      messageEffect: "projection_created",
    }),
  };
}
