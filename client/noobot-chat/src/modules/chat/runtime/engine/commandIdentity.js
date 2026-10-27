/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CHANNEL_IDENTITY_KEYS,
  selectAgentCommandIdentity,
} from "@noobot/agent-transport-protocol";

function channelIdentitySource(channel) {
  return {
    sessionId: channel.sessionId,
    parentSessionId: channel.parentSessionId,
  };
}

export function buildChannelIdentity(channel) {
  const source = channelIdentitySource(channel);
  return Object.fromEntries(CHANNEL_IDENTITY_KEYS.map((key) => [key, source[key]]));
}

export function buildAgentCommandIdentity(commandType, { channel, turn }) {
  return selectAgentCommandIdentity(commandType, { ...turn, ...channelIdentitySource(channel) });
}
