/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { deepFreeze } from "./deep-freeze.js";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const TIME_TIERS = deepFreeze({
  uiThrottleMs: 150,
  shortDelayMs: 300,
  fastProbeMs: 500,
  oneSecondMs: SECOND_MS,
  flushMs: 2000,
  hookMs: 3000,
  fiveSecondsMs: 5000,
  quickInspectMs: 6000,
  standardCommandMs: 30000,
  browserLoadMs: 45000,
  startupMs: MINUTE_MS,
  threeMinutesMs: 3 * MINUTE_MS,
  fiveMinutesMs: 5 * MINUTE_MS,
  oneHourMs: HOUR_MS,
  threeHoursMs: 3 * HOUR_MS,
  fiveHoursMs: 5 * HOUR_MS,
  oneDayMs: DAY_MS,
  thirtyDays: 30,
  micDurationSeconds: 60,
});

export const TIME_THRESHOLDS = deepFreeze({
  agent: {
    runTimeoutMs: TIME_TIERS.fiveHoursMs,
    minRunTimeoutMs: 10000,
    maxRunTimeoutMs: 12 * HOUR_MS,
    hookTimeoutMs: TIME_TIERS.hookMs,
    authorityOutboxDeliveredRetentionMs: TIME_TIERS.fiveMinutesMs,
    authorityOutboxCompactIntervalMs: TIME_TIERS.standardCommandMs,
  },

  async: {
    waitTimeoutMs: TIME_TIERS.fiveMinutesMs,
    minWaitTimeoutMs: TIME_TIERS.oneSecondMs,
    defaultPollIntervalMs: TIME_TIERS.oneSecondMs,
    defaultMaxWaitTimeMs: TIME_TIERS.standardCommandMs,
    sessionRunnerPollIntervalMs: TIME_TIERS.shortDelayMs,
  },

  memory: {
    summaryTimeoutMs: TIME_TIERS.fiveMinutesMs,
    executionBundleTimeoutMs: TIME_TIERS.fiveSecondsMs,
  },

  tools: {
    executeScriptTimeoutMs: TIME_TIERS.fiveMinutesMs,
    browserDevtoolsPortPollIntervalMs: 250,
    imagesAsyncPollIntervalMs: TIME_TIERS.fiveSecondsMs,
    imagesAsyncTimeoutMs: TIME_TIERS.threeMinutesMs,
    processForceKillGraceMs: TIME_TIERS.flushMs,
    processSettleGraceMs: TIME_TIERS.hookMs,
    nativeTaskCleanupRetryDelayMs: 100,
    dockerLockWaitTimeoutMs: TIME_TIERS.oneHourMs,
  },

  agentProxy: {
    webSocketHeartbeatIntervalMs: TIME_TIERS.standardCommandMs,
    webSocketHeartbeatTimeoutMs: TIME_TIERS.startupMs,
    dataPlaneMetricsIntervalMs: 10000,
    reconnectSnapshotTimeoutMs: TIME_TIERS.quickInspectMs,
    turnLifecycleReceiptTimeoutMs: TIME_TIERS.flushMs,
  },

  capability: {
    harnessHookMinTimeoutMs: TIME_TIERS.fiveMinutesMs,
  },

  openvscode: {
    startTimeoutMs: TIME_TIERS.startupMs,
    idleTimeoutMs: TIME_TIERS.threeHoursMs,
    cleanupIntervalMs: TIME_TIERS.startupMs,
    shutdownGraceMs: TIME_TIERS.fiveSecondsMs,
    touchPersistIntervalMs: TIME_TIERS.standardCommandMs,
    portProbeTimeoutMs: TIME_TIERS.fastProbeMs,
    waitProbeTimeoutMs: 350,
  },

  web: {
    browserDefaultTimeoutMs: TIME_TIERS.standardCommandMs,
    browserNetworkIdleTimeoutMs: 4500,
    web2img: {
      loadTimeoutMs: TIME_TIERS.browserLoadMs,
      readyStateTimeoutMs: 20000,
      networkIdleTimeoutMs: 12000,
      readyPostWaitMs: 800,
      gotoTimeoutMs: TIME_TIERS.browserLoadMs,
      expandVisibleTimeoutMs: TIME_TIERS.fastProbeMs,
      expandClickTimeoutMs: 800,
      expandPostClickWaitMs: TIME_TIERS.uiThrottleMs,
      scrollWaitMs: 450,
      scrollFinalTopWaitMs: TIME_TIERS.shortDelayMs,
      textStableIntervalMs: 700,
    },
  },

  harness: {
    hookTimeoutMs: TIME_TIERS.fiveMinutesMs,
    manifestDebounceMs: TIME_TIERS.fastProbeMs,
    manifestCacheMaxAgeMs: 10 * MINUTE_MS,
    manifestCleanupIntervalMs: TIME_TIERS.fiveMinutesMs,
    jsonlFlushIntervalMs: TIME_TIERS.flushMs,
    jsonlFlushMaxTimeMs: TIME_TIERS.flushMs,
    jsonlRetryBaseDelayMs: 200,
    jsonlRetryMaxDelayMs: TIME_TIERS.fiveSecondsMs,
    flushHookTimeoutMs: TIME_TIERS.flushMs,
    tmpFileMaxAgeMs: TIME_TIERS.oneDayMs,
    tmpCleanupMinIntervalMs: TIME_TIERS.fiveMinutesMs,
    cleanupGraceMs: 10 * MINUTE_MS,
    maxRunAgeDays: TIME_TIERS.thirtyDays,
    fsmCacheMaxAgeMs: 30 * MINUTE_MS,
    fsmCacheCleanupIntervalMs: TIME_TIERS.fiveMinutesMs,
    capabilityModelTimeoutMs: TIME_TIERS.threeMinutesMs,
    capabilityModelHookGraceMs: TIME_TIERS.fiveSecondsMs,
  },

  workflow: {
    timeoutMs: TIME_TIERS.fiveHoursMs,
    nodeAgentTimeoutMs: TIME_TIERS.fiveHoursMs,
  },

  client: {
    chatMessageNavigatorScrollLockMs: 1400,
    wsReconnectTimeoutMs: 15000,
    sessionLogReconnectBaseDelayMs: TIME_TIERS.oneSecondMs,
    sessionLogReconnectMaxDelayMs: TIME_TIERS.startupMs,
    sessionLogDebugTtlMs: TIME_TIERS.fiveSecondsMs,
    monotonicActionStopTimeoutMs: TIME_TIERS.hookMs,
    monotonicActionStopPollIntervalMs: 50,
    stopRequestTtlMs: TIME_TIERS.fiveMinutesMs,
    panelResizeThrottleMs: TIME_TIERS.uiThrottleMs,
    thinkingDetailRetryDelayMs: TIME_TIERS.shortDelayMs,
    micMaxDurationSeconds: TIME_TIERS.micDurationSeconds,
    terminalTurnRetentionMs: TIME_TIERS.oneDayMs,
  },

  service: {
    apiKeyTtlMs: TIME_TIERS.oneDayMs,
    orphanedTurnRecoveryGraceMs: TIME_TIERS.standardCommandMs,
    userInteractionTimeoutMs: 10 * MINUTE_MS,
    sessionLogRetentionMs: 7 * TIME_TIERS.oneDayMs,
    sessionLogCleanupIntervalMs: TIME_TIERS.oneHourMs,
    sessionLogMinIntervalMs: TIME_TIERS.startupMs,
  },
});

export function resolveUserInteractionTimeoutMs(env = process.env) {
  const configured = Number(env?.NOOBOT_USER_INTERACTION_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 1000) return Math.floor(configured);
  return TIME_THRESHOLDS.service.userInteractionTimeoutMs;
}
