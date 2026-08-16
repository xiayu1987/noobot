/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { rm } from "node:fs/promises";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

export async function cleanupNativeTaskDirectory(directory, { rmImpl = rm } = {}) {
  if (!String(directory || "").trim()) return;
  await rmImpl(directory, {
    recursive: true,
    force: true,
    maxRetries: TURN_THRESHOLDS.tools.nativeTaskCleanupMaxRetries,
    retryDelay: TIME_THRESHOLDS.tools.nativeTaskCleanupRetryDelayMs,
  });
}
