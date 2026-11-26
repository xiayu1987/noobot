/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { randomUUID } from "node:crypto";
import { createReplayBatch } from "@noobot/event-protocol";
import {
  AGENT_COMMAND,
  createTurnFinalizeCommand,
  createTurnSnapshotCommand,
  readKnownLifecycleSequence,
  selectAgentCommandIdentity,
} from "@noobot/agent-transport-protocol";
import { isActionableTurnRecovery } from "@noobot/session-protocol/turn-recovery";
import { TURN_SNAPSHOT_TERMINAL_LIMIT } from "@noobot/session-protocol/turn-lifecycle";
import { PENDING_COMMAND_KIND } from "../../command-registry.js";
import { connectSnapshotQuery } from "./snapshot-query-transport.js";

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
  return channels.flatMap((channel) => Array.from(channel.pendingInteractionRequests.values()));
}

function selectSnapshotChannel(channels) {
  return channels.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs).at(0);
}

function pendingSnapshot(channel) {
  return { channelKey: channel.key, kind: PENDING_COMMAND_KIND.TURN_SNAPSHOT };
}

function settlePendingSnapshot(registry, channel, commandId, result) {
  const record = registry.take(
    commandId,
    pendingSnapshot(channel),
    result.ok ? "delivered" : result.reason,
  );
  if (record) record.settle(result);
}

function createSnapshotPromise(registry, channel, commandId, socket) {
  return new Promise((resolve) => {
    const timeout = setTimeout(
      () =>
        settlePendingSnapshot(registry, channel, commandId, {
          ok: false,
          reason: "snapshot_timeout",
        }),
      TIME_THRESHOLDS.agentProxy.reconnectSnapshotTimeoutMs,
    );
    registry.register(commandId, {
      ...pendingSnapshot(channel),
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
  request.pendingCommandId = commandId;
  const promise = createSnapshotPromise(manager.commandRegistry, channel, commandId, socket);
  request.queryTransport.send(
    createTurnFinalizeCommand({
      commandId,
      identity: selectAgentCommandIdentity(AGENT_COMMAND.FINALIZE, channel.identity),
      options: { terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
    }),
  );
  const finalized = await promise;
  if (finalized?.ok === true && finalized.snapshot) return finalized;
  if (request.cancelled) return finalized;
  manager.logSessionEvent(channel, {
    category: "transport",
    level: "warn",
    event: "agentProxy.reconnect.recovery.finalizeFailed",
    sessionId,
    data: { sessionId, commandId, recovery, reason: finalized.reason },
  });
  return finalized;
}

function startSnapshotRequest(manager, socket, channel, knownSequence) {
  const { sessionId } = channel.identity;
  const commandId = `proxy-snapshot:${sessionId}:${randomUUID()}`;
  const registry = manager.commandRegistry;
  const request = {
    sessionId,
    channel,
    commandId,
    pendingCommandId: commandId,
    cancelled: false,
    settle(result) {
      settlePendingSnapshot(registry, channel, request.pendingCommandId, result);
    },
    cancel(reason) {
      request.cancelled = true;
      request.settle({ ok: false, reason });
      request.queryTransport.close(reason);
    },
  };
  const snapshotPromise = createSnapshotPromise(registry, channel, commandId, socket);
  const command = createTurnSnapshotCommand({
    commandId,
    identity: selectAgentCommandIdentity(AGENT_COMMAND.TURN_SNAPSHOT_GET, channel.identity),
    options: { knownSequence, terminalLimit: TURN_SNAPSHOT_TERMINAL_LIMIT.DEFAULT },
  });
  request.queryTransport = connectSnapshotQuery(manager, request, socket, command);
  request.promise = snapshotPromise
    .then((result) => settleFlaggedRecovery(manager, request, socket, result))
    .finally(() => request.queryTransport.close("snapshot_query_complete"));
  return request;
}

function createSessionReplay(manager, sessionId, channels, knownSequence) {
  const lifecycleReplay = manager.getTurnLifecycleReplayForChannels(
    channels,
    sessionId,
    knownSequence,
  );
  const hasActiveTurn = manager.hasActiveTurnLifecycleForChannels(channels, sessionId);
  const pendingInteractions = collectPendingInteractions(channels);
  const replayBatch = createReplayBatch({
    sessionId,
    snapshot: null,
    snapshotSequence: knownSequence,
    events: lifecycleReplay.events,
    pendingInteractions,
  });
  const snapshotRequired = lifecycleReplay.hasReplayGap || hasActiveTurn;
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
        startSnapshotRequest(manager, socket, selectSnapshotChannel(channels), knownSequence),
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
        snapshotSequence: sessionEntry.replayBatch.snapshotSequence,
        lifecycleTailCount: sessionEntry.replayBatch.events.length,
        pendingInteractionCount: sessionEntry.replayBatch.pendingInteractions.length,
        excludedDataPlaneEventCount: sessionChannels.reduce(
          (count, channel) => count + channel.eventJournal.events.length,
          0,
        ),
      },
    });
  }
}
