/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { config } from "../../../shared/config.js";
import { createReplayBatch, isPendingInteractionReplay } from "@noobot/event-protocol";
import {
  createTurnFinalizeCommand,
  createTurnSnapshotCommand,
  readKnownLifecycleSequence,
} from "@noobot/agent-transport-protocol";
import { isActionableTurnRecovery } from "@noobot/session-protocol";
import { TURN_SNAPSHOT_TERMINAL_LIMIT } from "@noobot/session-protocol/turn-lifecycle";
import { text } from "@noobot/shared/value";
import { PENDING_COMMAND_KIND } from "../../command-registry.js";

export function groupReconnectChannels(manager, channelKeys) {
  const channelsBySessionId = new Map();
  for (const channelKey of channelKeys) {
    const channel = manager.channelStore.get(channelKey);
    if (!channel) continue;
    const { sessionId } = channel.identity;
    if (!sessionId) continue;
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

function pendingSnapshot(channel) {
  return { channelKey: channel.key, kind: PENDING_COMMAND_KIND.TURN_SNAPSHOT };
}

export function cancelPendingSnapshot(manager, channel, commandId, reason) {
  const record = manager.commandRegistry.take(commandId, pendingSnapshot(channel), reason);
  if (record) record.settle({ ok: false, reason });
}

function createSnapshotPromise(manager, snapshotChannel, commandId, socket) {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () => cancelPendingSnapshot(manager, snapshotChannel, commandId, "snapshot_timeout"),
      config.reconnectSnapshotTimeoutMs,
    );
    manager.commandRegistry.register(commandId, {
      ...pendingSnapshot(snapshotChannel),
      socket,
      settle: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
    });
  });
}

async function settleFlaggedRecovery(manager, request, socket, snapshotResult) {
  const recovery = snapshotResult?.snapshot?.payload?.recovery;
  if (snapshotResult?.ok !== true || !isActionableTurnRecovery(recovery)) return snapshotResult;
  if (request.cancelled) return snapshotResult;
  const { channel, sessionId } = request;
  const commandId = `proxy-finalize:${sessionId}:${randomUUID()}`;
  request.commandIds.push(commandId);
  const promise = createSnapshotPromise(manager, channel, commandId, socket);
  const forwarded = manager.forwardToUpstream(
    channel,
    createTurnFinalizeCommand({
      commandId,
      identity: { sessionId },
      options: { terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
    }),
  );
  if (!forwarded) {
    cancelPendingSnapshot(manager, channel, commandId, "finalize_forward_failed");
  }
  const finalized = await promise;
  if (finalized?.ok === true && finalized.snapshot) return finalized;
  if (request.cancelled) return finalized;
  manager.logSessionEvent(channel, {
    category: "transport",
    level: "warn",
    event: "agentProxy.reconnect.recovery.finalizeFailed",
    sessionId,
    data: { sessionId, commandId, recovery, reason: text(finalized?.reason) },
  });
  return snapshotResult;
}

function startSnapshotRequest(manager, socket, sessionId, channels, knownSequence) {
  const channel = selectSnapshotChannel(channels);
  const commandId = `proxy-snapshot:${sessionId}:${randomUUID()}`;
  const request = { sessionId, channel, commandId, commandIds: [commandId], cancelled: false };
  const snapshotPromise = createSnapshotPromise(manager, channel, commandId, socket);
  const command = createTurnSnapshotCommand({
    commandId,
    identity: { sessionId },
    options: { knownSequence, terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
  });
  const forwarded = manager.forwardToUpstream(channel, command);
  const queryConnection = forwarded
    ? null
    : manager.connectUpstreamChannel(
        channel,
        socket.__agentProxyApiKey,
        socket.__agentProxyLocale,
        { initialCommands: [command], purpose: "snapshot_query" },
      );
  if (!forwarded && !queryConnection) {
    cancelPendingSnapshot(manager, channel, commandId, "snapshot_forward_failed");
  }
  request.queryConnection = queryConnection;
  request.promise = snapshotPromise.then((result) =>
    settleFlaggedRecovery(manager, request, socket, result),
  );
  return request;
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
  control,
  snapshotRequests = [],
}) {
  const sessionsMap = new Map();
  for (const [sessionId, channels] of channelsBySessionId) {
    const knownSequence = readKnownLifecycleSequence(control, sessionId);
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
      sessionId: sessionEntry.sessionId,
      data: {
        sessionId: sessionEntry.sessionId,
        snapshotSequence: Number(sessionEntry.replayBatch?.snapshotSequence || 0),
        lifecycleTailCount: sessionEntry.replayBatch?.events?.length || 0,
        pendingInteractionCount: sessionEntry.replayBatch?.pendingInteractions?.length || 0,
        excludedDataPlaneEventCount: sessionChannels.reduce(
          (count, channel) => count + channel.eventJournal.events.length,
          0,
        ),
      },
    });
  }
}
