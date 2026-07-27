/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

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
  twoDaysMs: 2 * DAY_MS,
  thirtyDays: 30,
  micDurationSeconds: 60,
});

export const TIME_THRESHOLDS = deepFreeze({
  agent: {
    runTimeoutMs: TIME_TIERS.fiveHoursMs,
    minRunTimeoutMs: 10000,
    maxRunTimeoutMs: 12 * HOUR_MS,
    hookTimeoutMs: TIME_TIERS.hookMs,
    pendingStopTtlMs: TIME_TIERS.standardCommandMs,
    transientLlmRetryBaseDelayMs: TIME_TIERS.fastProbeMs,
  },

  async: {
    waitTimeoutMs: TIME_TIERS.fiveMinutesMs,
    minWaitTimeoutMs: TIME_TIERS.oneSecondMs,
    fastCleanupMs: TIME_TIERS.oneSecondMs,
    retentionMs: TIME_TIERS.fiveMinutesMs,
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
    imagesAsyncPollIntervalMs: TIME_TIERS.fiveSecondsMs,
    imagesAsyncTimeoutMs: TIME_TIERS.threeMinutesMs,
    docToDataLibreOfficeBaseTimeoutMs: TIME_TIERS.threeMinutesMs,
    docToDataLibreOfficePerMiBTimeoutMs: TIME_TIERS.startupMs,
    docToDataLibreOfficeMaxTimeoutMs: TIME_TIERS.oneHourMs,
    docToDataLibreOfficeProgressCheckIntervalMs: TIME_TIERS.fiveSecondsMs,
    mediaToDataProbeTimeoutMs: TIME_TIERS.standardCommandMs,
    mediaToDataTranscodeTimeoutMs: TIME_TIERS.fiveMinutesMs,
    mediaToDataKillGraceMs: TIME_TIERS.hookMs,
    processForceKillGraceMs: TIME_TIERS.flushMs,
    dockerLockWaitTimeoutMs: TIME_TIERS.oneHourMs,
  },

  agentCollab: {
    waitTimeoutMs: TIME_TIERS.fiveMinutesMs,
    pollIntervalMs: TIME_TIERS.fiveSecondsMs,
  },

  agentProxy: {
    webSocketHeartbeatIntervalMs: TIME_TIERS.standardCommandMs,
    webSocketHeartbeatTimeoutMs: TIME_TIERS.startupMs,
  },

  capability: {
    separateModelMinTimeoutMs: TIME_TIERS.threeMinutesMs,
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

  connectors: {
    defaultCommandTimeoutMs: TIME_TIERS.standardCommandMs,
    channelCommandTimeoutMs: TIME_TIERS.standardCommandMs,
    quickInspectTimeoutMs: TIME_TIERS.quickInspectMs,
    serviceInspectTimeoutMs: TIME_TIERS.quickInspectMs,
    toolkitCommandTimeoutMs: 8000,
    postgresIdleTimeoutMs: TIME_TIERS.startupMs,
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
    hookTimeoutMs: TIME_TIERS.oneSecondMs,
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
    separateModelMinTimeoutMs: TIME_TIERS.threeMinutesMs,
  },

  workflow: {
    timeoutMs: TIME_TIERS.fiveHoursMs,
    nodeAgentTimeoutMs: TIME_TIERS.fiveHoursMs,
  },

  client: {
    chatMessageNavigatorScrollLockMs: 1400,
    wsStopCloseDelayMs: TIME_TIERS.shortDelayMs,
    wsTerminalChannelStateGraceMs: 250,
    wsReconnectTimeoutMs: 15000,
    wsOpenPollIntervalMs: 100,
    sessionLogReconnectBaseDelayMs: TIME_TIERS.oneSecondMs,
    sessionLogReconnectMaxDelayMs: TIME_TIERS.startupMs,
    thinkingTimingTtlMs: TIME_TIERS.twoDaysMs,
    monotonicActionStopTimeoutMs: TIME_TIERS.hookMs,
    monotonicActionStopPollIntervalMs: 50,
    stopRequestTtlMs: TIME_TIERS.fiveMinutesMs,
    deferredLifecycleEventTtlMs: TIME_TIERS.fiveMinutesMs,
    panelResizeThrottleMs: TIME_TIERS.uiThrottleMs,
    missingInteractionPayloadTimeoutMs: 1200,
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
