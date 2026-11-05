/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { deepFreeze } from "./deep-freeze.js";
import { bindRuntimeThresholds } from "./runtime-threshold-state.js";

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
  eightHoursMs: 8 * HOUR_MS,
  oneDayMs: DAY_MS,
  thirtyDays: 30,
  micDurationSeconds: 60,
});

export const DEFAULT_TIME_THRESHOLDS = deepFreeze({
  installers: {
    versionCheckTimeoutMs: 15000,
  },
  modelProxy: {
    logRetentionMs: 60 * 60 * 1000,
  },
  model: {
    emptyResponseRetryBaseDelayMs: 500,
    transportRetryBaseDelayMs: 250,
  },
  hooks: {
    defaultTimeoutMs: 3000,
  },
  fileMutation: {
    lockPollIntervalMs: 10,
    lockStaleMs: 60000,
    lockTimeoutMs: 30000,
  },
  runtimeEvents: {
    retentionDays: 7,
    cleanupIntervalMs: 60 * 1000,
    batchFlushMs: 50,
  },
  connectorInstances: {
    postgresIdleTimeoutMs: 30000,
    sshCommandTimeoutMs: 30000,
    mysqlTimeoutMs: 30000,
    postgresTimeoutMs: 30000,
    sqliteTimeoutMs: 30000,
  },
  userTemplate: {
    remoteInstanceCacheTtlMs: 60 * 60 * 1000,
  },
  mcp: {
    requestTimeoutMs: 30000,
  },
  desktop: {
    agentProxyStartupTimeoutMs: 60000,
    startupPollIntervalMs: 1000,
    crashRestartInitialDelayMs: 1000,
    crashRestartSecondDelayMs: 3000,
    crashRestartFinalDelayMs: 10000,
    dependencyDetectIntervalMs: 3000,
    dependencyDetectTimeoutMs: 90000,
    dependencyProcessTimeoutMs: 120000,
    dependencyProxyProbeTimeoutMs: 15000,
    crashRestartWindowMs: 10 * 60 * 1000,
    installerProgressIntervalMs: 30000,
    startupProgressReplayDelayMs: 3000,
    windowRecoveryDelayMs: 5000,
    healthProbeTimeoutMs: 1500,
  },
  agent: {
    runTimeoutMs: TIME_TIERS.eightHoursMs,
    minRunTimeoutMs: 10000,
    maxRunTimeoutMs: 12 * HOUR_MS,
    hookTimeoutMs: TIME_TIERS.hookMs,
    authorityOutboxDeliveredRetentionMs: TIME_TIERS.fiveMinutesMs,
    authorityOutboxCompactIntervalMs: TIME_TIERS.standardCommandMs,
    snapshotIdentityGuardMs: TIME_TIERS.oneSecondMs,
    terminalResolutionRetryDelayMs: 250,
  },

  memory: {
    summaryTimeoutMs: TIME_TIERS.fiveMinutesMs,
  },

  tools: {
    nativeBrowserMaxWaitMs: 30000,
    nativeCapabilityGraceMs: 5000,
    dockerExecuteTimeoutMs: 10000,
    nativeScriptForceKillGraceMs: 2000,
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
    fixedWindowMs: 60000,
    upstreamCloseGraceMs: 2000,
    reconnectPollIntervalMs: 25,
    channelRetentionMs: 10 * 60 * 1000,
    apiKeyRetentionMs: 24 * 60 * 60 * 1000,
    cleanupIntervalMs: 15000,
    requestIdTtlMs: 11 * 60 * 1000,
    httpUpstreamTimeoutMs: 60000,
    httpRateLimitWindowMs: 60000,
    wsRateLimitWindowMs: 60000,
    ideWsRateLimitWindowMs: 60000,
    ideHttpRateLimitWindowMs: 60000,
    webSocketHeartbeatIntervalMs: TIME_TIERS.standardCommandMs,
    webSocketHeartbeatTimeoutMs: TIME_TIERS.startupMs,
    dataPlaneMetricsIntervalMs: 10000,
    reconnectSnapshotTimeoutMs: TIME_TIERS.quickInspectMs,
    turnLifecycleReceiptTimeoutMs: TIME_TIERS.flushMs,
    invalidUpstreamFrameWindowMs: 10000,
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

  harness: {
    hookTimeoutMs: TIME_TIERS.fiveMinutesMs,
    manifestDebounceMs: TIME_TIERS.fastProbeMs,
    manifestCacheMaxAgeMs: 10 * MINUTE_MS,
    manifestCleanupIntervalMs: TIME_TIERS.fiveMinutesMs,
    jsonlFlushMaxTimeMs: TIME_TIERS.flushMs,
    jsonlRetryBaseDelayMs: 200,
    jsonlRetryMaxDelayMs: TIME_TIERS.fiveSecondsMs,
    flushHookTimeoutMs: TIME_TIERS.flushMs,
    tmpFileMaxAgeMs: TIME_TIERS.oneDayMs,
    tmpCleanupMinIntervalMs: TIME_TIERS.fiveMinutesMs,
    cleanupGraceMs: 10 * MINUTE_MS,
    runWriteLockStaleMs: 10 * MINUTE_MS,
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
    sessionLongPressDelayMs: TIME_TIERS.fastProbeMs,
    micDurationRefreshIntervalMs: 1000,
    thinkingElapsedRefreshIntervalMs: 1000,
    chatMessageNavigatorScrollLockMs: 1400,
    wsReconnectTimeoutMs: 15000,
    sessionLogReconnectBaseDelayMs: TIME_TIERS.oneSecondMs,
    sessionLogReconnectMaxDelayMs: TIME_TIERS.startupMs,
    sessionLogDebugTtlMs: TIME_TIERS.fiveSecondsMs,
    monotonicActionStopTimeoutMs: TIME_TIERS.hookMs,
    monotonicActionStopPollIntervalMs: 50,
    panelResizeThrottleMs: TIME_TIERS.uiThrottleMs,
    thinkingDetailRetryDelayMs: TIME_TIERS.shortDelayMs,
    micMaxDurationSeconds: TIME_TIERS.micDurationSeconds,
    terminalTurnRetentionMs: TIME_TIERS.oneDayMs,
    admissionRetryMinDelayMs: 250,
    admissionRetryMaxDelayMs: MINUTE_MS,
  },

  service: {
    httpAdmissionWindowMs: 60000,
    apiKeyTtlMs: TIME_TIERS.oneDayMs,
    orphanedTurnRecoveryGraceMs: TIME_TIERS.standardCommandMs,
    userInteractionTimeoutMs: 10 * MINUTE_MS,
    sessionLogMinIntervalMs: TIME_TIERS.startupMs,
    startupProgressIntervalMs: TIME_TIERS.oneSecondMs,
    startupHeartbeatIntervalMs: 10 * SECOND_MS,
    startupUnresponsiveTimeoutMs: 2 * MINUTE_MS,
    startupStallTimeoutMs: TIME_TIERS.fiveMinutesMs,
  },
  cli: {
    healthProbeMs: TIME_TIERS.fastProbeMs,
  },
});

export const TIME_THRESHOLDS = bindRuntimeThresholds("time", DEFAULT_TIME_THRESHOLDS);
