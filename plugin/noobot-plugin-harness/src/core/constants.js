/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const PLUGIN_NAME = "noobot-plugin-harness";
export const PLUGIN_VERSION = "4.2.3";

export const HARNESS_RUN_STATUS = Object.freeze({
  RUNNING: "running",
  SUCCESS: "success",
  ERROR: "error",
  ABORT: "abort",
  REVIEWED: "reviewed",
});

export const HARNESS_TERMINAL_RUN_STATUSES = new Set([
  HARNESS_RUN_STATUS.SUCCESS,
  HARNESS_RUN_STATUS.ERROR,
  HARNESS_RUN_STATUS.ABORT,
]);

export const HARNESS_FLUSH_REASONS = Object.freeze({
  NONE: "",
  TERMINAL: "terminal",
  ERROR: "error",
});

export const HARNESS_LIMITS = Object.freeze({
  JSONL_MAX_BUFFER_ENTRIES: QUANTITY_THRESHOLDS.harness.jsonlMaxBufferEntries,
  JSONL_MAX_BUFFER_BYTES: LENGTH_THRESHOLDS.harness.jsonlMaxBufferBytes,
});

export const HARNESS_FILES = Object.freeze({
  RUN_WRITE_LOCK: ".harness-write.lock",
});
