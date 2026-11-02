/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { deepFreeze } from "./deep-freeze.js";
import { bindRuntimeThresholds } from "./runtime-threshold-state.js";

const QUANTITY_TIERS = deepFreeze({
  localContext: 2,
  shallowDepth: 3,
  smallFiles: 8,
  smallDisplay: 10,
  standardBatch: 50,
  webTextLines: 4000,
  readableExtractLines: 1200,
});

export const DEFAULT_QUANTITY_THRESHOLDS = deepFreeze({
  service: {
    httpConnectionLimit: 120,
    httpMutationLimit: 120,
    httpReadLimit: 600,
  },
  runtimeEvents: {
    maxArchives: 20,
    maxCachedFiles: 512,
    batchMaxRecords: 100,
  },
  connectorInstances: {
    mysqlPoolLimit: 4,
    postgresPoolMax: 5,
  },
  eventProtocol: {
    authorityOutboxPendingBatchSize: 100,
  },
  longMemory: {
    workAssistantCollaborationMaxItems: 5,
    workQualityStandardsMaxItems: 5,
    workWorkStyleMaxItems: 5,
    workToolsMethodsMaxItems: 8,
    workLongTermProjectsMaxItems: 3,
    historyPreferencesCommonTopicsMaxItems: 8,
    socialImportantRelationshipsMaxItems: 5,
    personalityEmotionalTendenciesMaxItems: 3,
    personalityTraitsMaxItems: 5,
    interestsPreferredActivitiesMaxItems: 3,
    interestsFavoriteMusicMaxItems: 3,
    interestsFavoriteMoviesMaxItems: 5,
    interestsFavoriteBooksMaxItems: 5,
    interestsHobbiesMaxItems: 5,
  },
  contextProtocol: {
    turnSummaryCheckpointReceiptLimit: 50,
  },
  memory: {
    maxItems: 30,
  },

  attachments: {
    maxFileCount: QUANTITY_TIERS.smallFiles,
  },

  toolIO: {
    readMaxLines: 1000,

    readMaxLinesLimit: 5000,

    searchMaxResults: QUANTITY_TIERS.standardBatch,

    searchMaxResultsLimit: 500,

    searchContextLines: QUANTITY_TIERS.localContext,

    searchContextLinesLimit: 20,

    patchFailureContextRadius: QUANTITY_TIERS.shallowDepth,
  },

  diagnostics: {
    modelContextPreviewLimit: 40,
    executionReportSlowestToolCalls: 5,
  },

  web: {
    maxRedirects: 8,
    readableExtractMaxLines: QUANTITY_TIERS.readableExtractLines,

    textMaxLines: QUANTITY_TIERS.webTextLines,
  },

  desktop: {
    logRetainCount: 5,
  },

  harness: {
    jsonlFlushMaxSize: QUANTITY_TIERS.standardBatch,

    jsonlMaxBufferEntries: 5000,

    jsonlMaxFiles: 20,

    maxRuns: 100,

    completedDialogIds: 80,

    incrementalMessageCacheEntries: 200,
  },

  client: {
    resendDebugLimit: 12,
    toolLogDebugLimit: 20,
    consumedEventIdsLimit: 1000,

    executionLogDisplayLimit: QUANTITY_TIERS.smallDisplay,

    messageAnchorScrollOffsetPx: 16,

    messageAnchorCurrentThresholdPx: 24,

    messageListEstimatedRowHeightPx: 180,

    messageListInitialViewportHeightPx: 900,

    messageListVirtualOverscan: QUANTITY_TIERS.localContext,

    thinkingDetailEstimatedRowHeightPx: 32,

    thinkingDetailInitialViewportHeightPx: 600,

    thinkingDetailVirtualOverscan: QUANTITY_TIERS.smallFiles,

    thinkingDetailRetryLimit: QUANTITY_TIERS.smallFiles,

    frameHealthTopScriptLimit: 3,

    sessionListRecentDayGroupCount: 7,
  },

  sessionLog: {
    maxBatchSize: 100,

    maxQueueSize: 500,

    maxDebugQueueSize: 100,
  },

  agentProxy: {
    fixedWindowMaxRequests: 100,
    maxChannelEvents: 2000,
    maxConnections: 1000,
    httpRateLimitMaxRequests: 180,
    wsRateLimitMaxUpgrades: 80,
    ideWsRateLimitMaxUpgrades: 60,
    ideHttpRateLimitMaxRequests: 2000,
    maxReplayEvents: 5000,
    invalidUpstreamFrameLimit: 5,
    commandRemovalHistoryLimit: 256,
  },
});

export const QUANTITY_THRESHOLDS = bindRuntimeThresholds("quantity", DEFAULT_QUANTITY_THRESHOLDS);
