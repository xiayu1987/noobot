/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function disposeReconnectReplayTimers({
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
  missingInteractionPayloadTimers,
}) {
  const cacheExpiredRefreshTimer = getCacheExpiredRefreshTimer?.();
  if (cacheExpiredRefreshTimer) {
    clearTimeout(cacheExpiredRefreshTimer);
    setCacheExpiredRefreshTimer?.(null);
  }
  if (missingInteractionPayloadTimers instanceof Map) {
    for (const timer of missingInteractionPayloadTimers.values()) {
      clearTimeout(timer);
    }
    missingInteractionPayloadTimers.clear();
  }
}
