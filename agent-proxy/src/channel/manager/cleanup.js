/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  CHANNEL_RETENTION_PHASE,
  CHANNEL_ACTIVITY_PHASE,
  UPSTREAM_TRANSPORT_PHASE,
  UPSTREAM_CLOSE_REASON,
} from "../../shared/constants.js";
import { nowMs } from "../../shared/utils.js";

class CleanupMethods {
  cleanupExpiredChannels() {
    const currentMs = nowMs();
    for (const [channelKey, channel] of this.channelStore.entries()) {
      const canCleanupTerminal =
        channel.retention.phase === CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED &&
        currentMs >= channel.retention.cleanupAfterMs;
      const canCleanupIdle =
        channel.transport.phase === UPSTREAM_TRANSPORT_PHASE.IDLE &&
        channel.activity.phase === CHANNEL_ACTIVITY_PHASE.IDLE &&
        !channel.subscribers.size &&
        currentMs - channel.updatedAtMs > config.channelRetentionMs;
      if (!canCleanupTerminal && !canCleanupIdle) continue;
      this.closeUpstreamChannel(channel, 1000, UPSTREAM_CLOSE_REASON.CLEANUP);
      this.deleteChannel(channelKey);
    }
    for (const [apiKey, identityItem] of this.apiKeyIdentityStore.entries()) {
      if (currentMs - identityItem.updatedAtMs > config.apiKeyRetentionMs) {
        this.apiKeyIdentityStore.delete(apiKey);
      }
    }
    this.commandRegistry.cleanup((channelKey) => this.channelStore.has(channelKey));
  }
}

export const cleanupMethods = Object.getOwnPropertyDescriptors(CleanupMethods.prototype);
delete cleanupMethods.constructor;
