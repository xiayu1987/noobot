/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Central quantity-related thresholds.
 *
 * Keep character/byte/string-size thresholds in length-thresholds.mjs. Keep
 * durations in time-thresholds.mjs. Keep loop turns and retry/attempt counts in
 * turn-thresholds.mjs. This module is for item counts, line counts, result
 * counts, file counts, display counts, buffer entry counts, and concurrency.
 *
 * Value tiers:
 * - 2-3: local context/depth guards.
 * - 8-10: small user-facing sets and displayed realtime logs.
 * - 20-50: recent diagnostic windows, search results, and JSONL flush batches.
 * - 80-100: retained lifecycle/run records.
 * - 500-4000: file read/search/web text cleaning and extraction breadth.
 * - 5000: in-memory JSONL backpressure guard.
 * - 8/60 concurrency: default web fan-out and hard concurrency ceiling.
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
    // Short-memory items that trigger long-memory extraction.
    maxItems: 30,
  },

  attachments: {
    // Max uploaded files accepted in one request/session payload.
    maxFileCount: QUANTITY_TIERS.smallFiles,
  },

  agentCollab: {
    // Max nested sub-agent delegation depth.
    maxSubAgentDepth: QUANTITY_TIERS.shallowDepth,
  },

  toolIO: {
    // Default line window for workspace file reads.
    readMaxLines: 500,

    // Default result count for workspace search.
    searchMaxResults: QUANTITY_TIERS.standardBatch,

    // Default surrounding line count included for workspace search matches.
    searchContextLines: QUANTITY_TIERS.localContext,

    // Default file count scanned by workspace search.
    searchMaxFiles: 2000,
  },

  diagnostics: {
    // Number of message-context trace entries included in diagnostics.
    modelContextPreviewLimit: 40,
  },

  web: {
    // Default concurrent URL processing tasks in web_to_data.
    defaultConcurrency: QUANTITY_TIERS.smallFiles,

    // Max concurrent URL processing tasks in web_to_data.
    maxConcurrency: 60,

    // Smaller line window for readable web extraction and web2img text extraction.
    readableExtractMaxLines: QUANTITY_TIERS.readableExtractLines,

    // Default max lines retained by web/plain text line cleaners.
    textMaxLines: QUANTITY_TIERS.webTextLines,
  },

  harness: {
    // JSONL records accumulated before flushing by size.
    jsonlBatchSize: QUANTITY_TIERS.standardBatch,

    // JSONL flush strategy record count threshold.
    jsonlFlushMaxSize: QUANTITY_TIERS.standardBatch,

    // Max buffered JSONL entries before forcing a flush/drop.
    jsonlMaxBufferEntries: 5000,

    // Max rotated JSONL files kept beside the active file.
    jsonlMaxFiles: 20,

    // Max harness run directories kept by cleanup.
    maxRuns: 100,

    // Completed dialog process ids retained for turn lifecycle checks.
    completedDialogIds: 80,

    // Max wrapper depth scanned while unwrapping checklist payloads.
    wrappedPayloadMaxDepth: QUANTITY_TIERS.shallowDepth,
  },

  client: {
    // Realtime execution logs kept on message/process views.
    executionLogDisplayLimit: QUANTITY_TIERS.smallDisplay,

    // Compatibility process logs kept during reconnect replay/reduction.
    processCompatLogLimit: QUANTITY_TIERS.smallDisplay,
  },
});
