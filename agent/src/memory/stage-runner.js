/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isAbortError } from "../shared/utils/error-utils.js";

export const MEMORY_SUMMARY_STAGE = Object.freeze({
  LONG_MEMORY: "long_memory",
  EXPERIENCE_DAILY: "experience_daily",
  EXPERIENCE_WEEKLY: "experience_weekly",
  EXPERIENCE_MONTHLY: "experience_monthly",
  EXPERIENCE_YEARLY: "experience_yearly",
});

export async function runMemorySummaryStage(stage, run, { abortSignal = null, onStageError }) {
  if (typeof onStageError !== "function") {
    throw new TypeError("memory summary stage requires onStageError");
  }
  try {
    return await run();
  } catch (error) {
    if (isAbortError(error, abortSignal)) throw error;
    await onStageError({ stage, error });
    return false;
  }
}
