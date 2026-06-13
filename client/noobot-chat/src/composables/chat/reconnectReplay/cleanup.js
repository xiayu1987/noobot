/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function disposeReconnectReplayTimers({
  missingInteractionPayloadTimers,
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
}) {
  for (const timer of missingInteractionPayloadTimers.values()) {
    clearTimeout(timer);
  }
  missingInteractionPayloadTimers.clear();

  const cacheExpiredRefreshTimer = getCacheExpiredRefreshTimer?.();
  if (cacheExpiredRefreshTimer) {
    clearTimeout(cacheExpiredRefreshTimer);
    setCacheExpiredRefreshTimer?.(null);
  }
}
