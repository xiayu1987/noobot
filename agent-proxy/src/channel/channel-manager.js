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

const CHANNEL_LOG_RESERVED_KEYS = [
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
];

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
    this.commandRegistry = new CommandRegistry({
      defaultTtlMs: config.requestIdTtlMs,
      onRemove: (removal) => this.logCommandRemoval(removal),
    });
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
    const total =
      current.upstreamMessages +
      current.channelEvents +
      current.broadcasts +
      current.deliveries +
      current.lifecycleReceipts;
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

  logCommandRemoval(removal) {
    if (removal?.reason === "delivered") return false;
    const channel = this.channelStore.get(removal?.channelKey);
    return this.logChannelEvent(channel, {
      category: "transport",
      level: "info",
      event: "agentProxy.commandRegistry.removed",
      data: { ...removal },
    });
  }

  logChannelEvent(channel, event = {}) {
    if (!this.sessionLogClient || !channel) return false;
    for (const key of CHANNEL_LOG_RESERVED_KEYS) {
      if (Object.hasOwn(event, key)) {
        throw new TypeError(`logChannelEvent does not accept ${key}; use logSessionEvent`);
      }
    }
    const { sessionId, parentSessionId } = channel.identity;
    return this.writeSessionLog(channel, {
      ...event,
      sessionId,
      parentSessionId,
      dialogProcessId: "",
      turnScopeId: "",
    });
  }

  logSessionEvent(channel, event = {}) {
    if (!this.sessionLogClient || !channel) return false;
    const sessionId = resolveOptionalSessionId(event.sessionId);
    if (!sessionId) {
      throw new TypeError(`logSessionEvent requires sessionId: ${event.event || ""}`);
    }
    return this.writeSessionLog(channel, {
      ...event,
      sessionId,
      parentSessionId: resolveOptionalSessionId(event.parentSessionId),
      dialogProcessId: event.dialogProcessId || "",
      turnScopeId: event.turnScopeId || "",
    });
  }

  writeSessionLog(channel, event) {
    const data = event.data && typeof event.data === "object" ? { ...event.data } : undefined;
    const logEvent = { ...event, scope: "session", ...(data ? { data } : {}) };
    if (!logEvent.parentSessionId) delete logEvent.parentSessionId;
    return this.sessionLogClient.log(channel.apiKey, logEvent);
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
