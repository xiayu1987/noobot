/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  EVENT_TYPE,
  CHANNEL_STATUS,
} from "../../shared/constants.js";
import { nowMs } from "../../shared/utils.js";
import { writeAgentProxyRouteLifecycleEvent } from "../../runtime-events/ws-runtime-events.js";
import {
  createReplayBatch,
  isPendingInteractionReplay,
} from "@noobot/event-protocol";
import { createTurnSnapshotCommand } from "@noobot/agent-transport-protocol";

class ReconnectMethods {

async handleReconnect(socket, payload = {}) {
  if ("lastReceivedSeqMap" in payload || "lastReceivedTurnScopeIdMap" in payload) {
    throw new Error("unsupported_reconnect_message_cursor");
  }
  this.clearPendingLifecycleDeliveries(socket);
  const currentSessionId = String(payload?.currentSessionId || "").trim();
  const requestId = String(payload?.requestId || "").trim();
  const knownLifecycleSequenceMap = payload?.knownLifecycleSequenceMap || {};
  const reconnectChannelKeys = this._resolveReconnectChannelKeys(socket, currentSessionId, payload);
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.reconnect.started",
    socket,
    data: {
      currentSessionIdPresent: Boolean(currentSessionId),
      channelCount: reconnectChannelKeys.length,
    },
  });
  if (!reconnectChannelKeys.length) {
    this.sendSocketEvent(socket, {
      event: EVENT_TYPE.RECONNECT_DATA,
      data: {
        currentSessionId,
        sessions: [],
        requestId,
      },
    });
    this.sendSocketEvent(socket, {
      event: EVENT_TYPE.RECONNECT_COMPLETE,
      data: {
        totalSessions: 0,
        requestId,
      },
    });
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.reconnect.completed",
      socket,
      data: { totalSessions: 0 },
    });
    return;
  }

  const sessionsMap = new Map();
  const channelsBySessionId = new Map();
  const snapshotRequests = [];
  const reconnectTransaction = { eventBuffer: [], channelStateBaseline: [] };
  socket.__agentProxyReconnectTransaction = reconnectTransaction;

  for (const channelKey of reconnectChannelKeys) {
    const channel = this.channelStore.get(channelKey);
    const channelSessionId = this._extractSessionIdFromChannelKey(channelKey);
    if (!channel || !channelSessionId) continue;
    const sessionChannels = channelsBySessionId.get(channelSessionId) || [];
    sessionChannels.push(channel);
    channelsBySessionId.set(channelSessionId, sessionChannels);
  }

  for (const [channelSessionId, sessionChannels] of channelsBySessionId) {
    const knownLifecycleSequence = Number(knownLifecycleSequenceMap[channelSessionId] || 0);
    const lifecycleReplay = this.getTurnLifecycleReplayForChannels(
      sessionChannels,
      channelSessionId,
      knownLifecycleSequence,
    );
    const cachedActiveTurn = this.getActiveTurnLifecycleProjectionForChannels(
      sessionChannels,
      channelSessionId,
    );
    const requiresAuthoritySnapshot = lifecycleReplay.hasReplayGap || Boolean(cachedActiveTurn);
    const pendingInteractions = sessionChannels.flatMap((channel) =>
      Array.from(channel?.pendingInteractionRequests?.values?.() || [])
        .filter((envelope) => isPendingInteractionReplay(envelope))
        .map((envelope) => this._withChannelSessionScope(channel, envelope)),
    );
    sessionsMap.set(channelSessionId, {
      sessionId: channelSessionId,
      replayBatch: createReplayBatch({
        sessionId: channelSessionId,
        snapshotSequence: knownLifecycleSequence,
        events: lifecycleReplay.events,
        pendingInteractions,
      }),
    });
    this.logSessionEvent?.(sessionChannels[0], {
      category: "transport",
      event: "agentProxy.reconnect.pendingInteractionProjection",
      sessionId: channelSessionId,
      data: {
        pendingInteractionCount: pendingInteractions.length,
        lifecycleReplayCount: lifecycleReplay.events.length,
        snapshotRequired: requiresAuthoritySnapshot,
      },
    });
    if (requiresAuthoritySnapshot) {
      const snapshotChannel = sessionChannels
        .filter(Boolean)
        .sort((left, right) => Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0))
        .at(0);
      const commandId = `proxy-snapshot:${channelSessionId}:${nowMs()}`;
      snapshotChannel.pendingSnapshotRequests ||= new Map();
      const snapshotPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          snapshotChannel.pendingSnapshotRequests.delete(commandId);
          resolve({ ok: false, reason: "snapshot_timeout" });
        }, config.reconnectSnapshotTimeoutMs);
        snapshotChannel.pendingSnapshotRequests.set(commandId, {
          socket,
          resolve: (result) => {
            clearTimeout(timeout);
            resolve(result);
          },
        });
      });
      const snapshotCommand = createTurnSnapshotCommand({
        commandId,
        identity: { sessionId: channelSessionId },
        options: { knownSequence: knownLifecycleSequence },
      });
      const forwarded = this.forwardToUpstream(snapshotChannel, snapshotCommand);
      const queryConnection = forwarded ? null : this.connectUpstreamChannel(
        snapshotChannel,
        String(socket?.__agentProxyApiKey || "").trim(),
        String(socket?.__agentProxyLocale || "").trim(),
        {
          initialPayload: null,
          initialCommands: [snapshotCommand],
          purpose: "snapshot_query",
        },
      );
      if (!forwarded && !queryConnection) {
        const pendingRequest = snapshotChannel.pendingSnapshotRequests.get(commandId);
        snapshotChannel.pendingSnapshotRequests.delete(commandId);
        pendingRequest?.resolve?.({ ok: false, reason: "snapshot_forward_failed" });
      }
      snapshotRequests.push({
        sessionId: channelSessionId,
        channel: snapshotChannel,
        commandId,
        queryConnection,
        promise: snapshotPromise,
      });
    }
  }

  for (const channelKey of reconnectChannelKeys) {
    const channel = this.channelStore.get(channelKey);
    if (!channel) continue;

    this.attachSubscriber(channel, socket, { sendStateSnapshot: false });
    reconnectTransaction.channelStateBaseline.push(
      ...this.buildChannelStateSnapshot(channel),
    );
  }

  const sessions = Array.from(sessionsMap.values());
  const snapshotResults = snapshotRequests.length
    ? await Promise.all(snapshotRequests.map(async (request) => ({
        ...request,
        result: await request.promise,
      })))
    : [];
  if (socket.__agentProxyReconnectTransaction !== reconnectTransaction) return;
  for (const { sessionId, channel, commandId, queryConnection, result } of snapshotResults) {
    channel.transport.closeOwnedConnection(
      queryConnection,
      1000,
      "snapshot_query_complete",
      { purpose: "snapshot_query" },
    );
    const sessionEntry = sessionsMap.get(sessionId);
    if (result?.ok === true && result.snapshot) {
      const snapshotSequence = Number(result.snapshot?.sequence || 0);
      sessionEntry.replayBatch = createReplayBatch({
        ...sessionEntry.replayBatch,
        snapshot: result.snapshot,
        snapshotSequence,
        events: (sessionEntry.replayBatch?.events || []).filter(
          (event) => Number(event?.sequence || 0) > snapshotSequence,
        ),
      });
      this.logSessionEvent(channel, {
        category: "transport",
        event: "agentProxy.reconnect.snapshot.resolved",
        data: {
          sessionId,
          commandId,
          snapshotSequence,
          activeTurnScopeId: String(result.snapshot?.activeTurnScopeId || "").trim(),
          replacedTurnScopeIds: (Array.isArray(result.snapshot?.replacedTurns)
            ? result.snapshot.replacedTurns
            : [])
            .map((replacement) => String(replacement?.turnScopeId || "").trim())
            .filter(Boolean),
        },
      });
      continue;
    }
    const snapshotFailureReason = String(result?.reason || "snapshot_failed");
    this.logSessionEvent(channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.reconnect.snapshot.failed",
      data: { sessionId, commandId, reason: snapshotFailureReason },
    });
    socket.__agentProxyReconnectTransaction = null;
    throw new Error(`authoritative_snapshot_failed:${sessionId}:${snapshotFailureReason}`);
  }

  for (const sessionEntry of sessions) {
    const sessionChannels = channelsBySessionId.get(sessionEntry.sessionId) || [];
    const logChannel = sessionChannels[0];
    if (!logChannel) continue;
    this.logSessionEvent(logChannel, {
      category: "transport",
      event: "agentProxy.reconnect.authorityBatch.prepared",
      data: {
        sessionId: sessionEntry.sessionId,
        snapshotSequence: Number(sessionEntry.replayBatch?.snapshotSequence || 0),
        lifecycleTailCount: sessionEntry.replayBatch?.events?.length || 0,
        pendingInteractionCount: sessionEntry.replayBatch?.pendingInteractions?.length || 0,
        excludedDataPlaneEventCount: sessionChannels.reduce(
          (count, channel) => count + Number(channel?.eventLog?.length || 0),
          0,
        ),
      },
    });
  }

  this.sendSocketEvent(socket, {
    event: EVENT_TYPE.RECONNECT_DATA,
    data: {
      currentSessionId,
      sessions: sessions.map(({ replayBatch, ...session }) => ({
        ...session,
        replayBatch,
      })),
      requestId,
    },
  });

  for (const envelope of reconnectTransaction.channelStateBaseline) {
    this.sendSocketEvent(socket, envelope);
  }
  const bufferedEvents = reconnectTransaction.eventBuffer;
  socket.__agentProxyReconnectTransaction = null;
  for (const bufferedEvent of bufferedEvents) {
    const envelope = bufferedEvent?.envelope;
    if (!envelope) continue;
    const bufferedChannel = this.channelStore.get(bufferedEvent.channelKey);
    const sendResult = this.sendChannelEvent(bufferedChannel, socket, envelope);
    if (!["sent", "queued"].includes(sendResult.result)) continue;
    if (envelope.event === EVENT_TYPE.TURN_LIFECYCLE) continue;
    socket.__agentProxyLastSequenceByChannel ||= {};
    socket.__agentProxyLastSequenceByChannel[bufferedEvent.channelKey] = Number(
      bufferedEvent.sequence || 0,
    );
  }

  this.sendSocketEvent(socket, {
    event: EVENT_TYPE.RECONNECT_COMPLETE,
    data: {
      totalSessions: sessions.length,
      requestId,
    },
  });
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.reconnect.completed",
    socket,
    data: {
      totalSessions: sessions.length,
    },
  });
}

_resolveReconnectChannelKeys(socket, currentSessionId = "", payload = {}) {
  const currentSocketChannelKeys = Array.from(
    socket?.__agentProxyChannelKeys instanceof Set ? socket.__agentProxyChannelKeys : [],
  ).filter(Boolean);
  if (currentSocketChannelKeys.length) {
    return currentSocketChannelKeys;
  }
  const normalizedCurrentSessionId = String(currentSessionId || "").trim();
  const requesterApiKey = String(socket?.__agentProxyApiKey || "").trim();
  const requesterUserId = String(socket?.__agentProxyUserId || payload?.userId || "").trim();
  const resolvedChannelKeys = [];
  for (const [channelKey, channel] of this.channelStore.entries()) {
    if (!channel) continue;
    if (
      normalizedCurrentSessionId &&
      this._extractSessionIdFromChannelKey(channelKey) !== normalizedCurrentSessionId &&
      channel.activity.phase !== CHANNEL_STATUS.RUNNING &&
      channel.transport.phase !== CHANNEL_STATUS.CONNECTING &&
      !channel.pendingInteractionRequests?.size
    ) {
      continue;
    }
    if (!this.hasChannelPermission(channel, requesterApiKey, requesterUserId)) continue;
    resolvedChannelKeys.push(channelKey);
  }
  return resolvedChannelKeys;
}

_extractSessionIdFromChannelKey(channelKey = "") {
  const parts = String(channelKey || "").split("::");
  return parts.length >= 2 ? parts[1] : "";
}
}

export const reconnectMethods = Object.getOwnPropertyDescriptors(ReconnectMethods.prototype);
delete reconnectMethods.constructor;
