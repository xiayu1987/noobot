/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../config.js";
import { CHANNEL_STATUS, UPSTREAM_CLOSE_REASON } from "../constants.js";
import { nowMs, isTerminalStatus } from "../utils.js";

class CleanupMethods {
// ---- Cleanup ----

cleanupExpiredChannels() {
  const currentMs = nowMs();
  for (const [channelKey, channel] of this.channelStore.entries()) {
    const canCleanupTerminal =
      isTerminalStatus(channel.status) &&
      Number(channel.cleanupAfterMs || 0) > 0 &&
      currentMs >= Number(channel.cleanupAfterMs || 0);
    const canCleanupIdle =
      channel.status === CHANNEL_STATUS.IDLE &&
      !channel.subscribers.size &&
      currentMs - Number(channel.updatedAtMs || currentMs) > config.channelRetentionMs;
    if (!canCleanupTerminal && !canCleanupIdle) continue;
    this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLEANUP);
    for (const [requestId, mappedEntry] of this.requestChannelMap.entries()) {
      const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
      if (mappedChannelKey === channelKey) {
        this.requestChannelMap.delete(requestId);
      }
    }
    this.channelStore.delete(channelKey);
  }
  for (const [apiKey, identityItem] of this.apiKeyIdentityStore.entries()) {
    const updatedAtMs = Number(identityItem?.updatedAtMs || 0);
    if (!updatedAtMs || currentMs - updatedAtMs > config.apiKeyRetentionMs) {
      this.apiKeyIdentityStore.delete(apiKey);
    }
  }
  for (const [requestId, mappedEntry] of this.requestChannelMap.entries()) {
    const createdAtMs = typeof mappedEntry === "object" ? Number(mappedEntry.createdAtMs || 0) : 0;
    const mappedChannelKey = typeof mappedEntry === "object" ? mappedEntry.channelKey : mappedEntry;
    const mappedChannel = this.channelStore.get(mappedChannelKey);
    if (mappedChannel?.pendingInteractionRequests?.has(requestId)) {
      continue;
    }
    if (!createdAtMs || currentMs - createdAtMs > config.requestIdTtlMs) {
      this.requestChannelMap.delete(requestId);
    }
  }
}
}

export const cleanupMethods = Object.getOwnPropertyDescriptors(CleanupMethods.prototype);
delete cleanupMethods.constructor;
