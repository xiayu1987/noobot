/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { config } from "../../../shared/config.js";
import { createReplayBatch, isPendingInteractionReplay } from "@noobot/event-protocol";
import { createTurnSnapshotCommand } from "@noobot/agent-transport-protocol";

function text(value) {
  return String(value || "").trim();
}

export function groupReconnectChannels(manager, channelKeys) {
  const channelsBySessionId = new Map();
  for (const channelKey of channelKeys) {
    const channel = manager.channelStore.get(channelKey);
    const sessionId = manager._extractSessionIdFromChannelKey(channelKey);
    if (!channel || !sessionId) continue;
    const channels = channelsBySessionId.get(sessionId) || [];
    channels.push(channel);
    channelsBySessionId.set(sessionId, channels);
  }
  return channelsBySessionId;
}

function collectPendingInteractions(channels) {
  return channels.flatMap((channel) =>
    Array.from(channel?.pendingInteractionRequests?.values?.() || []).filter((envelope) =>
      isPendingInteractionReplay(envelope),
    ),
  );
}

function selectSnapshotChannel(channels) {
  return channels
    .filter(Boolean)
    .sort((left, right) => Number(right?.updatedAtMs || 0) - Number(left?.updatedAtMs || 0))
    .at(0);
}

function createSnapshotPromise(snapshotChannel, commandId, socket) {
  return new Promise((resolve) => {
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
}

function startSnapshotRequest(manager, socket, sessionId, channels, knownSequence) {
  const channel = selectSnapshotChannel(channels);
  const commandId = `proxy-snapshot:${sessionId}:${randomUUID()}`;
  channel.pendingSnapshotRequests ||= new Map();
  const promise = createSnapshotPromise(channel, commandId, socket);
  const command = createTurnSnapshotCommand({
    commandId,
    identity: { sessionId },
    options: { knownSequence },
  });
  const forwarded = manager.forwardToUpstream(channel, command);
  const queryConnection = forwarded
    ? null
    : manager.connectUpstreamChannel(
        channel,
        text(socket?.__agentProxyApiKey),
        text(socket?.__agentProxyLocale),
        { initialPayload: null, initialCommands: [command], purpose: "snapshot_query" },
      );
  if (!forwarded && !queryConnection) {
    const pendingRequest = channel.pendingSnapshotRequests.get(commandId);
    channel.pendingSnapshotRequests.delete(commandId);
    pendingRequest?.resolve?.({ ok: false, reason: "snapshot_forward_failed" });
  }
  return { sessionId, channel, commandId, queryConnection, promise };
}

function createSessionReplay(manager, sessionId, channels, knownSequence) {
  const lifecycleReplay = manager.getTurnLifecycleReplayForChannels(
    channels,
    sessionId,
    knownSequence,
  );
  const cachedActiveTurn = manager.getActiveTurnLifecycleProjectionForChannels(channels, sessionId);
  const pendingInteractions = collectPendingInteractions(channels);
  const replayBatch = createReplayBatch({
    sessionId,
    orderingDomain: "session",
    orderingScopeId: sessionId,
    snapshotSequence: knownSequence,
    events: lifecycleReplay.events,
    pendingInteractions,
  });
  const snapshotRequired = lifecycleReplay.hasReplayGap || Boolean(cachedActiveTurn);
  manager.logSessionEvent?.(channels[0], {
    category: "transport",
    event: "agentProxy.reconnect.pendingInteractionProjection",
    sessionId,
    data: {
      pendingInteractionCount: pendingInteractions.length,
      lifecycleReplayCount: lifecycleReplay.events.length,
      snapshotRequired,
    },
  });
  return { replayBatch, snapshotRequired };
}

export function prepareSessionReplays({
  manager,
  socket,
  channelsBySessionId,
  knownLifecycleSequenceMap,
  snapshotRequests = [],
}) {
  const sessionsMap = new Map();
  for (const [sessionId, channels] of channelsBySessionId) {
    const knownSequence = Number(knownLifecycleSequenceMap[sessionId] || 0);
    const { replayBatch, snapshotRequired } = createSessionReplay(
      manager,
      sessionId,
      channels,
      knownSequence,
    );
    sessionsMap.set(sessionId, { sessionId, replayBatch });
    if (snapshotRequired) {
      snapshotRequests.push(
        startSnapshotRequest(manager, socket, sessionId, channels, knownSequence),
      );
    }
  }
  return { sessionsMap, snapshotRequests };
}

export function logPreparedAuthorityBatches(manager, sessions, channelsBySessionId) {
  for (const sessionEntry of sessions) {
    const sessionChannels = channelsBySessionId.get(sessionEntry.sessionId) || [];
    const logChannel = sessionChannels[0];
    if (!logChannel) continue;
    manager.logSessionEvent(logChannel, {
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
}
