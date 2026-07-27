/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildToolTimelineFromLegacyLogs,
} from "./toolTimeline";
import {
  buildActivityTimelineFromLegacyLogs,
} from "./activityTimeline";
import { createTurnKey, resolveTurnIdentity } from "./turnIdentity";
import { createTurnObservation } from "./turnObservation";

const array = (value) => Array.isArray(value) ? value : [];

function legacyLogStream(realtimeLogs, completedLogs) {
  const realtime = array(realtimeLogs);
  return {
    logs: [...realtime, ...array(completedLogs)],
    assumeTool: (_log, index) => index >= realtime.length,
    assumeCompleted: (_log, index) => index >= realtime.length,
  };
}

function buildLegacyToolTimeline(stream) {
  return buildToolTimelineFromLegacyLogs(stream.logs, {
    assumeTool: stream.assumeTool,
    assumeCompleted: stream.assumeCompleted,
  });
}

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
  const selectedToolTimeline = processToolTimeline.length
    ? processToolTimeline
    : messageToolTimeline;
  const selectedStream = processToolTimeline.length ? processStream : messageStream;

  const canonicalToolTimeline = array(message.toolTimeline);
  const canonicalActivityTimeline = array(message.activityTimeline);
  const toolTimeline = canonicalToolTimeline.length
    ? canonicalToolTimeline
    : buildLegacyToolTimeline(selectedStream);
  const activityTimeline = canonicalActivityTimeline.length
    ? canonicalActivityTimeline
    : buildActivityTimelineFromLegacyLogs(processLogs.length ? processLogs : messageLogs);

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
