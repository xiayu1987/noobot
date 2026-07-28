/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createReconnectReplayPublicApi({
  applyReconnectData,
  applyReconnectEvent,
  applyChannelState,
  replayCache,
  appliedReconnectSeqByDialogProcessId,
  terminalDialogProcessIdSet,
  isTestMode = false,
}) {
  return {
    applyReconnectData,
    applyReconnectEvent,
    applyChannelState,
    __test: isTestMode
      ? {
          replayCache,
          appliedReconnectSeqByDialogProcessId,
          terminalDialogProcessIdSet,
        }
      : undefined,
  };
}
