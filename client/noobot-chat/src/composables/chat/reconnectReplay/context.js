/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createReconnectReplayContext() {
  return {
    replayCache: {},
    appliedReconnectSeqByDialogProcessId: {},
    terminalDialogProcessIdSet: new Set(),
    missingInteractionPayloadTimers: new Map(),
    cacheExpiredRefreshTimer: null,
    replayHydrationPromise: null,
  };
}
