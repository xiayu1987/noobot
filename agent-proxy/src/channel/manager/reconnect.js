/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { config } from "../../shared/config.js";
import {
  EVENT_TYPE,
  CHANNEL_RETENTION_PHASE,
  CHANNEL_STATUS,
  RECONNECT_SUGGESTION,
} from "../../shared/constants.js";
import { ensureConnectionId, nowMs } from "../../shared/utils.js";
import { writeAgentProxyRouteLifecycleEvent } from "../../runtime-events/ws-runtime-events.js";
import {
  createReplayBatch,
  isPendingInteractionReplay,
} from "@noobot/event-protocol";

class ReconnectMethods {

async handleReconnect(socket, payload = {}) {
  this.clearPendingLifecycleDeliveries(socket);
  const lastReceivedSeqMap = payload?.lastReceivedSeqMap || {};
  const lastReceivedTurnScopeIdMap = payload?.lastReceivedTurnScopeIdMap || {};
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
        cacheExpired: false,
        expiredDialogProcessIds: [],
        suggestion: RECONNECT_SUGGESTION.NONE,
        requestId,
      },
    });
    this.sendSocketEvent(socket, {
      event: EVENT_TYPE.RECONNECT_COMPLETE,
      data: {
        totalSessions: 0,
        cacheExpired: false,
        requestId,
      },
    });
    void writeAgentProxyRouteLifecycleEvent({
      event: "agentProxy.route.reconnect.completed",
      socket,
      data: { totalSessions: 0, cacheExpired: false },
    });
    return;
  }

  const sessionsMap = new Map();
  const expiredDialogProcessIds = [];
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
        .filter((envelope) =>
          isPendingInteractionReplay(envelope) &&
          String(envelope?.data?.sessionId || "").trim() === channelSessionId)
        .map((envelope) => this._withChannelSessionScope(channel, envelope)),
    );
    sessionsMap.set(channelSessionId, {
      sessionId: channelSessionId,
      dialogProcesses: [],
      replayBatch: createReplayBatch({
        sessionId: channelSessionId,
        snapshotSequence: knownLifecycleSequence,
        events: lifecycleReplay.events,
        pendingInteractions,
      }),
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
      const snapshotCommand = {
        action: "turn.snapshot.get",
        commandType: "turn.snapshot.get",
        commandId,
        userId: String(socket?.__agentProxyUserId || "").trim(),
        sessionId: channelSessionId,
        knownSequence: knownLifecycleSequence,
      };
      const forwarded = this.forwardToUpstream(snapshotChannel, snapshotCommand);
      const queryConnection = forwarded ? null : this.connectUpstreamChannel(
        snapshotChannel,
        String(socket?.__agentProxyApiKey || "").trim(),
        String(socket?.__agentProxyLocale || "").trim(),
        { initialPayload: null, initialCommands: [snapshotCommand] },
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
        closeQueryConnection: Boolean(queryConnection),
        promise: snapshotPromise,
      });
    }
  }

  for (const channelKey of reconnectChannelKeys) {
    const channel = this.channelStore.get(channelKey);
    if (!channel) continue;

    const channelSessionId = this._extractSessionIdFromChannelKey(channelKey);
    if (!channelSessionId) continue;

    this.attachSubscriber(channel, socket, { sendStateSnapshot: false });
    reconnectTransaction.channelStateBaseline.push(
      ...this.buildChannelStateSnapshot(channel),
    );

    const sessionEntry = sessionsMap.get(channelSessionId);
    const dialogProcessIdsInLog = new Set();
    for (const envelope of channel.eventLog) {
      const dpId = String(envelope?.data?.dialogProcessId || "").trim();
      if (dpId) dialogProcessIdsInLog.add(dpId);
    }

    const parts = channelKey.split("::");
    if (parts.length >= 4 && parts[3]) {
      dialogProcessIdsInLog.add(parts[3]);
    }

    for (const dpId of dialogProcessIdsInLog) {
      const lastSeq = Number(lastReceivedSeqMap[dpId] || 0);
      const reconnectTurnScopeId = String(
        lastReceivedTurnScopeIdMap?.[dpId] || "",
      ).trim();
      const dialogHasPendingInteraction = this._findPendingInteractionsByDialogProcessId(
        channel,
        dpId,
      ).length > 0;
      if (
        lastSeq <= 0 &&
        !dialogHasPendingInteraction &&
        channel.retention.phase === CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED
      ) {
        this.logSessionEvent(channel, {
          category: "transport",
          event: "agentProxy.reconnect.replay.skipped",
          data: {
            channelKey,
            connectionId: ensureConnectionId(socket),
            sessionId: channelSessionId,
            dialogProcessId: dpId,
            turnScopeId: reconnectTurnScopeId,
            lastSequence: lastSeq,
            result: "skipped",
            dropReason: "terminal_without_cursor",
          },
        });
        continue;
      }

      const filteredCounts = {
        dialogProcessMismatch: 0,
        turnScopeMismatch: 0,
        terminalError: 0,
        resolvedInteraction: 0,
        atOrBeforeCursor: 0,
      };
      const missingEvents = channel.eventLog.filter((envelope) => {
        const envDpId = String(envelope?.data?.dialogProcessId || "").trim();
        if (envDpId !== dpId) {
          filteredCounts.dialogProcessMismatch += 1;
          return false;
        }

        const envelopeTurnScopeId = String(envelope?.data?.turnScopeId || "").trim();
        if (
          reconnectTurnScopeId &&
          envelopeTurnScopeId !== reconnectTurnScopeId
        ) {
          filteredCounts.turnScopeMismatch += 1;
          return false;
        }

        if (
          channel.retention.phase === CHANNEL_RETENTION_PHASE.TERMINAL_RETAINED &&
          String(envelope?.event || "").trim() === EVENT_TYPE.ERROR
        ) {
          filteredCounts.terminalError += 1;
          return false;
        }

        if (
          String(envelope?.event || "").trim() ===
          EVENT_TYPE.INTERACTION_REQUEST
        ) {
          const requestId = String(envelope?.data?.requestId || "").trim();
          if (!requestId || !channel.pendingInteractionRequests.has(requestId)) {
            filteredCounts.resolvedInteraction += 1;
            return false;
          }
        }

        const upstreamSeq = Number(envelope?.data?.seq || 0);
        const proxySeq = Number(envelope?.sequence || 0);
        const comparableSequence = upstreamSeq > 0 ? upstreamSeq : proxySeq;
        const afterCursor = comparableSequence > lastSeq;
        if (!afterCursor) filteredCounts.atOrBeforeCursor += 1;
        return afterCursor;
      });
      const missingRequestIds = new Set(
        missingEvents
          .map((envelope) => String(envelope?.data?.requestId || "").trim())
          .filter(Boolean),
      );
      const pendingInteractionEvents = Array.from(channel.pendingInteractionRequests.values())
        .filter((envelope) => {
          if (!isPendingInteractionReplay(envelope)) return false;
          const envDpId = String(envelope?.data?.dialogProcessId || "").trim();
          const envelopeTurnScopeId = String(envelope?.data?.turnScopeId || "").trim();
          const requestId = String(envelope?.data?.requestId || "").trim();
          const matchesRun =
            !reconnectTurnScopeId ||
            envelopeTurnScopeId === reconnectTurnScopeId;
          return envDpId === dpId && matchesRun && requestId && !missingRequestIds.has(requestId);
        })
        .map((envelope) => this._withChannelSessionScope(channel, envelope));
      const replayEvents = [...missingEvents].sort((left, right) => {
        const leftSeq = Number(left?.data?.seq || left?.sequence || 0);
        const rightSeq = Number(right?.data?.seq || right?.sequence || 0);
        return leftSeq - rightSeq;
      });
      const pendingByRequestId = new Map(
        (sessionEntry.replayBatch?.pendingInteractions || [])
          .map((interaction) => [String(interaction?.data?.requestId || interaction?.requestId || "").trim(), interaction])
          .filter(([requestId]) => requestId),
      );
      for (const interaction of pendingInteractionEvents.map((event) => this._withChannelSessionScope(channel, event))) {
        const requestId = String(interaction?.data?.requestId || interaction?.requestId || "").trim();
        if (requestId) pendingByRequestId.set(requestId, interaction);
      }
      sessionEntry.replayBatch = createReplayBatch({
        ...sessionEntry.replayBatch,
        pendingInteractions: [...pendingByRequestId.values()],
      });
      const replayLimit = Math.max(0, Number(config.maxReplayEvents || 0));
      const replayedCount = replayLimit > 0
        ? Math.min(replayEvents.length, replayLimit)
        : replayEvents.length;
      this.logSessionEvent(channel, {
        category: "transport",
        event: "agentProxy.reconnect.replay.evaluated",
        data: {
          channelKey,
          connectionId: ensureConnectionId(socket),
          sessionId: channelSessionId,
          dialogProcessId: dpId,
          turnScopeId: reconnectTurnScopeId,
          lastSequence: lastSeq,
          cachedEventCount: channel.eventLog.length,
          missingEventCount: missingEvents.length,
          pendingInteractionCount: pendingInteractionEvents.length,
          replayedCount,
          truncatedCount: Math.max(0, replayEvents.length - replayedCount),
          filteredCounts,
          result: replayEvents.length ? "replayed" : "empty",
          dropReason: replayEvents.length ? "" : (lastSeq > 0 ? "cursor_gap_or_cache_expired" : "no_events_after_cursor"),
        },
      });

      if (replayEvents.length > 0) {
        const replayMessages = replayEvents
          .slice(0, config.maxReplayEvents)
          .map((eventEnvelope) => this._withChannelSessionScope(channel, eventEnvelope));
        const replayTurnScopeIds = new Set(
          replayMessages
            .map((eventEnvelope) => String(eventEnvelope?.data?.turnScopeId || "").trim())
            .filter(Boolean),
        );
        sessionEntry.dialogProcesses.push({
          dialogProcessId: dpId,
          ...(replayTurnScopeIds.size === 1 ? { turnScopeId: [...replayTurnScopeIds][0] } : {}),
          parentDialogProcessId: String(payload?.parentDialogProcessId || "").trim(),
          messages: replayMessages,
        });
      } else if (lastSeq > 0) {
        expiredDialogProcessIds.push(dpId);
        sessionEntry.replayBatch = createReplayBatch({
          ...sessionEntry.replayBatch,
          cacheExpired: true,
          expiredDialogProcessIds: [
            ...(sessionEntry.replayBatch?.expiredDialogProcessIds || []),
            dpId,
          ],
        });
        this.logSessionEvent(channel, {
          category: "transport",
          level: "warn",
          event: "agentProxy.reconnect.cache.expired",
          data: {
            channelKey,
            connectionId: ensureConnectionId(socket),
            sessionId: channelSessionId,
            dialogProcessId: dpId,
            turnScopeId: reconnectTurnScopeId,
            lastSequence: lastSeq,
            result: "expired",
            dropReason: "cursor_gap_or_cache_expired",
          },
        });
      }
    }
  }

  const sessions = Array.from(sessionsMap.values());
  const cacheExpired = expiredDialogProcessIds.length > 0;

  const snapshotResults = snapshotRequests.length
    ? await Promise.all(snapshotRequests.map(async (request) => ({
        ...request,
        result: await request.promise,
      })))
    : [];
  if (socket.__agentProxyReconnectTransaction !== reconnectTransaction) return;
  for (const { sessionId, channel, commandId, closeQueryConnection, result } of snapshotResults) {
    if (closeQueryConnection) this.closeUpstreamChannel(channel, 1000, "snapshot_query_complete");
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

  this.sendSocketEvent(socket, {
    event: EVENT_TYPE.RECONNECT_DATA,
    data: {
      currentSessionId,
      sessions: sessions.map(({ replayBatch, ...session }) => ({
        ...session,
        replayBatch,
      })),
      cacheExpired,
      expiredDialogProcessIds,
      suggestion: cacheExpired
        ? RECONNECT_SUGGESTION.RELOAD_SESSION_HISTORY
        : RECONNECT_SUGGESTION.NONE,
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
      cacheExpired,
      requestId,
    },
  });
  void writeAgentProxyRouteLifecycleEvent({
    event: "agentProxy.route.reconnect.completed",
    socket,
    data: {
      totalSessions: sessions.length,
      cacheExpired: expiredDialogProcessIds.length > 0,
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
