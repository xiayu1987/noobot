/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  RUNTIME_EVENT_SCOPES,
  SERVICE_STARTUP_EVENTS,
  SERVICE_STARTUP_SOURCE,
  reportRuntimeEventFailure,
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

function progressPhaseKey(progress) {
  return `${progress.userIndex}:${progress.stage}:${progress.upgradeId}`;
}

export function createThrottledProgressReporter({
  write,
  intervalMs = TIME_THRESHOLDS.service.startupProgressIntervalMs,
  now = Date.now,
}) {
  let lastPhaseKey = "";
  let lastWrittenAt = 0;
  let pending = null;
  const flush = () => {
    if (!pending) return;
    const progress = pending;
    pending = null;
    write(progress);
  };
  const report = (progress) => {
    const phaseKey = progressPhaseKey(progress);
    const currentTime = now();
    if (phaseKey === lastPhaseKey && currentTime - lastWrittenAt < intervalMs) {
      pending = progress;
      return;
    }
    if (phaseKey !== lastPhaseKey) flush();
    pending = null;
    lastPhaseKey = phaseKey;
    lastWrittenAt = currentTime;
    write(progress);
  };
  report.flush = flush;
  return report;
}

export function writeStartupProgressEvent(progress) {
  return writeStartupStateEvent(SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS, progress);
}

function writeStartupStateEvent(event, data) {
  return writeRuntimeEvent({
    scope: RUNTIME_EVENT_SCOPES.STARTUP,
    source: SERVICE_STARTUP_SOURCE,
    channel: RUNTIME_EVENT_CHANNELS.STARTUP,
    category: RUNTIME_EVENT_CATEGORIES.STATE,
    level: "info",
    event,
    data,
  }).catch((error) => {
    reportRuntimeEventFailure("startup state write failed", { event }, error);
  });
}

export function startStartupHeartbeat({
  write = (data) => writeStartupStateEvent(SERVICE_STARTUP_EVENTS.HEARTBEAT, data),
  intervalMs = TIME_THRESHOLDS.service.startupHeartbeatIntervalMs,
} = {}) {
  write({});
  const timer = setInterval(() => write({}), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
