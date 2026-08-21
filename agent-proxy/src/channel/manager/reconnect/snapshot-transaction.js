/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createReplayBatch } from "@noobot/event-protocol";

function text(value) {
  return String(value || "").trim();
}

export function createReconnectTransaction(snapshotRequests) {
  const transaction = {
    eventBuffer: [],
    channelStateBaseline: [],
    snapshotRequests,
    cancelled: false,
    cancel(reason = "reconnect_cancelled") {
      if (transaction.cancelled) return;
      transaction.cancelled = true;
      for (const request of snapshotRequests) {
        const pendingRequest = request.channel?.pendingSnapshotRequests?.get(request.commandId);
        request.channel?.pendingSnapshotRequests?.delete(request.commandId);
        pendingRequest?.resolve?.({ ok: false, reason });
        request.channel?.transport?.closeOwnedConnection(request.queryConnection, 1000, reason, {
          purpose: "snapshot_query",
        });
      }
    },
  };
  return transaction;
}

export async function settleSnapshotRequests(snapshotRequests) {
  return Promise.all(
    snapshotRequests.map(async (request) => ({
      ...request,
      result: await request.promise,
    })),
  );
}

function mergeResolvedSnapshot(sessionEntry, sessionId, snapshot) {
  const snapshotSequence = Number(snapshot?.ordering?.sequence || 0);
  sessionEntry.replayBatch = createReplayBatch({
    ...sessionEntry.replayBatch,
    snapshot,
    snapshotSequence,
    orderingDomain: "session",
    orderingScopeId: sessionId,
    events: (sessionEntry.replayBatch?.events || []).filter(
      (event) => Number(event?.ordering?.sequence || 0) > snapshotSequence,
    ),
  });
  return snapshotSequence;
}

function logResolvedSnapshot(manager, channel, request, snapshotSequence) {
  manager.logSessionEvent(channel, {
    category: "transport",
    event: "agentProxy.reconnect.snapshot.resolved",
    data: {
      sessionId: request.sessionId,
      commandId: request.commandId,
      snapshotSequence,
      activeTurnScopeId: text(request.result.snapshot?.payload?.activeTurnScopeId),
      replacedTurnScopeIds: (Array.isArray(request.result.snapshot?.payload?.replacedTurns)
        ? request.result.snapshot.payload.replacedTurns
        : []
      )
        .map((replacement) => text(replacement?.turnScopeId))
        .filter(Boolean),
    },
  });
}

export function applySnapshotResults(manager, sessionsMap, snapshotResults) {
  const deletedSessionIds = new Set();
  for (const request of snapshotResults) {
    request.channel.transport.closeOwnedConnection(
      request.queryConnection,
      1000,
      "snapshot_query_complete",
      { purpose: "snapshot_query" },
    );
    const sessionEntry = sessionsMap.get(request.sessionId);
    if (request.result?.ok === true && request.result.snapshot) {
      const snapshotSequence = mergeResolvedSnapshot(
        sessionEntry,
        request.sessionId,
        request.result.snapshot,
      );
      logResolvedSnapshot(manager, request.channel, request, snapshotSequence);
      continue;
    }
    const reason = text(request.result?.reason || "snapshot_failed");
    manager.logSessionEvent(request.channel, {
      category: "transport",
      level: "warn",
      event: "agentProxy.reconnect.snapshot.failed",
      data: { sessionId: request.sessionId, commandId: request.commandId, reason },
    });
    if (reason === "session_not_found") {
      sessionsMap.delete(request.sessionId);
      deletedSessionIds.add(request.sessionId);
      manager.deleteChannel(request.channel.key);
      continue;
    }
    throw new Error(`authoritative_snapshot_failed:${request.sessionId}:${reason}`);
  }
  return deletedSessionIds;
}
