/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { channelstoreMethods } from "./manager/channel-store.js";
import { subscriberbroadcastMethods } from "./manager/subscriber-broadcast.js";
import { upstreamconnectionMethods } from "./manager/upstream-connection.js";
import { channelflowMethods } from "./manager/channel-flow.js";
import { reconnectMethods } from "./manager/reconnect.js";
import { cleanupMethods } from "./manager/cleanup.js";
import { UpstreamTransportSupervisor } from "../websocket/upstream-transport-supervisor.js";
import { CommandRegistry } from "./command-registry.js";
import { config } from "../shared/config.js";
import { ChannelEventJournal } from "./channel-event-journal.js";
import { resolveOptionalSessionId } from "@noobot/runtime-events/session-id";

const DATA_PLANE_METRIC_KEYS = new Set([
  "upstreamMessages",
  "channelEvents",
  "broadcasts",
  "deliveries",
  "lifecycleReceipts",
]);

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
    this.successfulDataPlaneMetrics = {
      windowStartedAtMs: Date.now(),
      upstreamMessages: 0,
      channelEvents: 0,
      broadcasts: 0,
      deliveries: 0,
      lifecycleReceipts: 0,
    };
  }

  recordSuccessfulDataPlaneOperation(operation = "", count = 1) {
    const key = String(operation || "").trim();
    if (!DATA_PLANE_METRIC_KEYS.has(key)) return false;
    this.successfulDataPlaneMetrics[key] += Math.max(0, Number(count || 0));
    return true;
  }

  drainSuccessfulDataPlaneMetrics(nowMs = Date.now()) {
    const current = this.successfulDataPlaneMetrics;
    const total = current.upstreamMessages + current.channelEvents + current.broadcasts +
      current.deliveries + current.lifecycleReceipts;
    if (!total) return null;
    this.successfulDataPlaneMetrics = {
      windowStartedAtMs: nowMs,
      upstreamMessages: 0,
      channelEvents: 0,
      broadcasts: 0,
      deliveries: 0,
      lifecycleReceipts: 0,
    };
    return { ...current, windowEndedAtMs: nowMs };
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
      turnScopeId: event.turnScopeId || event.data?.turnScopeId || "",
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
