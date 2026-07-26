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
import { UpstreamTransportSupervisor } from "./upstream-transport-supervisor.js";
import { CommandRegistry } from "./command-registry.js";
import { config } from "./config.js";
import { ChannelEventJournal } from "./channel-event-journal.js";
import { resolveOptionalSessionId } from "@noobot/runtime-events/session-id";

export class ChannelManager {
  constructor(WebSocket, { sessionLogClient = null } = {}) {
    this.WebSocket = WebSocket;
    this.sessionLogClient = sessionLogClient;
    this.channelStore = new Map();
    this.commandRegistry = new CommandRegistry({ defaultTtlMs: config.requestIdTtlMs });
    this.requestChannelMap = this.commandRegistry.routes;
    this.apiKeyIdentityStore = new Map();
    this.createUpstreamTransport = () => new UpstreamTransportSupervisor(WebSocket);
    this.createEventJournal = () => new ChannelEventJournal({ maxEvents: config.maxChannelEvents });
  }

  logSessionEvent(channel, event = {}) {
    if (!this.sessionLogClient || !channel) return false;
    const channelSessionId = resolveOptionalSessionId(this._extractSessionIdFromChannelKey?.(channel.key));
    const sessionId = resolveOptionalSessionId(
      event.sessionId,
      event.data?.sessionId,
      channel.startPayload?.sessionId,
      channelSessionId,
      "agent-proxy",
    );
    const parentSessionId = resolveOptionalSessionId(
      event.parentSessionId,
      event.data?.parentSessionId,
      channelSessionId && channelSessionId !== sessionId ? channelSessionId : "",
      channel.startPayload?.parentSessionId,
    );
    const logEvent = {
      ...event,
      sessionId,
      ...(parentSessionId ? { parentSessionId } : {}),
      dialogProcessId: event.dialogProcessId || event.data?.dialogProcessId || channel.startPayload?.dialogProcessId || "",
      turnScopeId: event.turnScopeId || event.data?.turnScopeId || channel.startPayload?.turnScopeId || "",
    };
    if (!parentSessionId) delete logEvent.parentSessionId;
    if (logEvent.data && !resolveOptionalSessionId(logEvent.data.parentSessionId)) {
      logEvent.data = { ...logEvent.data };
      delete logEvent.data.parentSessionId;
    }
    return this.sessionLogClient.log(channel.apiKey || channel.ownerApiKey || "", logEvent);
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
