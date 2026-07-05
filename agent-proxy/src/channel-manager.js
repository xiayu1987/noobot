/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { channelstoreMethods } from "./channel-manager/channel-store.js";
import { subscriberbroadcastMethods } from "./channel-manager/subscriber-broadcast.js";
import { upstreamconnectionMethods } from "./channel-manager/upstream-connection.js";
import { channelflowMethods } from "./channel-manager/channel-flow.js";
import { reconnectMethods } from "./channel-manager/reconnect.js";
import { cleanupMethods } from "./channel-manager/cleanup.js";

export class ChannelManager {
  constructor(WebSocket, { sessionLogClient = null } = {}) {
    this.WebSocket = WebSocket;
    this.sessionLogClient = sessionLogClient;
    this.channelStore = new Map();
    this.requestChannelMap = new Map();
    this.apiKeyIdentityStore = new Map();
  }

  logSessionEvent(channel, event = {}) {
    if (!this.sessionLogClient || !channel) return false;
    const sessionId = String(
      event.sessionId || event.data?.sessionId || channel.startPayload?.sessionId || this._extractSessionIdFromChannelKey?.(channel.key) || "agent-proxy",
    ).trim();
    return this.sessionLogClient.log(channel.apiKey || channel.ownerApiKey || "", {
      ...event,
      sessionId,
      dialogProcessId: event.dialogProcessId || event.data?.dialogProcessId || channel.startPayload?.dialogProcessId || "",
      turnScopeId: event.turnScopeId || event.data?.turnScopeId || channel.startPayload?.turnScopeId || "",
    });
  }
}

for (const methodDescriptors of [
  channelstoreMethods,
  subscriberbroadcastMethods,
  upstreamconnectionMethods,
  channelflowMethods,
  reconnectMethods,
  cleanupMethods,
]) {
  Object.defineProperties(ChannelManager.prototype, methodDescriptors);
}
