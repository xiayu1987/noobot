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

const QUANTITY_TIERS = deepFreeze({
  localContext: 2,
  shallowDepth: 3,
  smallFiles: 8,
  smallDisplay: 10,
  standardBatch: 50,
  webTextLines: 4000,
  readableExtractLines: 1200,
});

export const QUANTITY_THRESHOLDS = deepFreeze({
  memory: {
    maxItems: 30,
  },

  attachments: {
    maxFileCount: QUANTITY_TIERS.smallFiles,
  },

  agentCollab: {
    maxSubAgentDepth: QUANTITY_TIERS.shallowDepth,
  },

  toolIO: {
    logSummaryLimit: 180,

    readMaxLines: 1000,

    searchMaxResults: QUANTITY_TIERS.standardBatch,

    searchContextLines: QUANTITY_TIERS.localContext,

    searchMaxFiles: 2000,
  },

  diagnostics: {
    modelContextPreviewLimit: 40,
  },

  web: {
    defaultConcurrency: QUANTITY_TIERS.smallFiles,

    maxConcurrency: 60,

    readableExtractMaxLines: QUANTITY_TIERS.readableExtractLines,

    textMaxLines: QUANTITY_TIERS.webTextLines,
  },

  harness: {
    jsonlBatchSize: QUANTITY_TIERS.standardBatch,

    jsonlFlushMaxSize: QUANTITY_TIERS.standardBatch,

    jsonlMaxBufferEntries: 5000,

    jsonlMaxFiles: 20,

    maxRuns: 100,

    completedDialogIds: 80,

    incrementalMessageCacheEntries: 200,

    wrappedPayloadMaxDepth: QUANTITY_TIERS.shallowDepth,
  },

  client: {
    executionLogDisplayLimit: QUANTITY_TIERS.smallDisplay,

    processCompatLogLimit: QUANTITY_TIERS.smallDisplay,
  },

  sessionLog: {
    maxBatchSize: 100,

    maxQueueSize: 500,

    maxDebugQueueSize: 100,

    maxDebugQueueBytes: 1024 * 1024,
  },
});
