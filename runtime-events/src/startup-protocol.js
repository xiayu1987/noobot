/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { RUNTIME_EVENT_CATEGORIES, RUNTIME_EVENT_SCOPES } from "./constants.js";
import { resolveRuntimeEventFile, resolveRuntimeEventsConfig } from "./paths.js";
import { listJsonLineFilesNewestFirst } from "./transports/jsonl.js";

export const SERVICE_STARTUP_SOURCE = "service";

export const SERVICE_STARTUP_EVENTS = Object.freeze({
  CONTEXT_LOADED: "service.startup.context.loaded",
  LISTEN_STARTED: "service.startup.httpServer.listen.started",
  WORKSPACE_PREPARATION_COMPLETED: "service.startup.workspacePreparation.completed",
  WORKSPACE_PREPARATION_FAILED: "service.startup.workspacePreparation.failed",
  WORKSPACE_PREPARATION_PROGRESS: "service.startup.workspacePreparation.progress",
  HEARTBEAT: "service.startup.heartbeat",
  FAILED: "service.startup.failed",
});

export const SERVICE_STARTUP_STATES = Object.freeze({
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
});

const TERMINAL_STATE_BY_EVENT = new Map([
  [SERVICE_STARTUP_EVENTS.LISTEN_STARTED, SERVICE_STARTUP_STATES.READY],
  [SERVICE_STARTUP_EVENTS.FAILED, SERVICE_STARTUP_STATES.FAILED],
]);

export const SERVICE_STARTUP_PROGRESS_STAGES = Object.freeze({
  LAYOUT_UPGRADE: "layoutUpgrade",
  DISPLAY_SUMMARY: "displaySummary",
});

export const SERVICE_STARTUP_LIVENESS = Object.freeze({
  ACTIVE: "active",
  STALLED: "stalled",
  UNRESPONSIVE: "unresponsive",
});

export const SERVICE_STARTUP_STALL_TIMEOUT_ENV = "NOOBOT_STARTUP_STALL_TIMEOUT_MS";

export function resolveServiceStartupStallTimeoutMs(env = process.env) {
  const raw = env[SERVICE_STARTUP_STALL_TIMEOUT_ENV];
  if (raw === undefined || raw === "") return TIME_THRESHOLDS.service.startupStallTimeoutMs;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(
      `${SERVICE_STARTUP_STALL_TIMEOUT_ENV} must be a positive integer, got: ${raw}`,
    );
  }
  return value;
}

export function assessServiceStartupLiveness(
  { heartbeatAt, progressAt },
  { now = Date.now(), stallTimeoutMs = TIME_THRESHOLDS.service.startupStallTimeoutMs } = {},
) {
  if (!heartbeatAt) return { liveness: SERVICE_STARTUP_LIVENESS.ACTIVE, idleMs: 0 };
  const heartbeatIdleMs = now - Date.parse(heartbeatAt);
  if (heartbeatIdleMs > TIME_THRESHOLDS.service.startupUnresponsiveTimeoutMs) {
    return { liveness: SERVICE_STARTUP_LIVENESS.UNRESPONSIVE, idleMs: heartbeatIdleMs };
  }
  const progressIdleMs = progressAt ? now - Date.parse(progressAt) : 0;
  if (progressIdleMs > stallTimeoutMs) {
    return { liveness: SERVICE_STARTUP_LIVENESS.STALLED, idleMs: progressIdleMs };
  }
  return { liveness: SERVICE_STARTUP_LIVENESS.ACTIVE, idleMs: progressIdleMs };
}

function resolveServiceStartupStateFile(env) {
  return resolveRuntimeEventFile(
    {
      scope: RUNTIME_EVENT_SCOPES.STARTUP,
      source: SERVICE_STARTUP_SOURCE,
      category: RUNTIME_EVENT_CATEGORIES.STATE,
    },
    resolveRuntimeEventsConfig({ env }),
  );
}

async function readCompleteLines(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const lines = raw.split("\n");
  lines.pop();
  return lines;
}

function resolveStartupIdentity({ pid, launchId }) {
  if (launchId !== undefined) {
    if (pid !== undefined)
      throw new TypeError("service startup identity accepts pid or launchId, not both");
    if (typeof launchId !== "string" || !launchId) {
      throw new TypeError(`service startup launchId must be a non-empty string, got: ${launchId}`);
    }
    return (record) => record.process.launchId === launchId;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new TypeError(`service startup pid must be a positive integer, got: ${pid}`);
  }
  return (record) => record.process.pid === pid;
}

function scanStartupRecords(lines, matches, scan) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const record = JSON.parse(lines[index]);
    if (!matches(record)) continue;
    if (!scan.progress && record.event === SERVICE_STARTUP_EVENTS.WORKSPACE_PREPARATION_PROGRESS) {
      scan.progress = record.data;
      scan.progressAt = record.time;
    }
    if (!scan.heartbeatAt && record.event === SERVICE_STARTUP_EVENTS.HEARTBEAT) {
      scan.heartbeatAt = record.time;
    }
    const state = TERMINAL_STATE_BY_EVENT.get(record.event);
    if (state) return { state, event: record.event, data: record.data };
  }
  return null;
}

export async function readServiceStartupState({ pid, launchId, env = process.env }) {
  const matches = resolveStartupIdentity({ pid, launchId });
  const scan = { progress: null, progressAt: "", heartbeatAt: "" };
  for (const file of await listJsonLineFilesNewestFirst(resolveServiceStartupStateFile(env))) {
    const terminal = scanStartupRecords(await readCompleteLines(file), matches, scan);
    if (terminal) return terminal;
  }
  return { state: SERVICE_STARTUP_STATES.PENDING, ...scan };
}
