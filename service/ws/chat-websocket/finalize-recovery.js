/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  recoverOrphanedTurn as recoverAuthoritativeOrphanedTurn,
  recoverTurnFinalize as recoverAuthoritativeTurnFinalize,
} from "@noobot/authoritative-state/application";

export async function recoverTurnFinalize({
  bot,
  commitTurnLifecycle,
  userId,
  sessionId,
  parentSessionId = "",
  commandId,
  terminalLimit,
} = {}) {
  const reader = bot?.getTurnLifecycleSnapshot;
  return recoverAuthoritativeTurnFinalize({
    readSnapshot: typeof reader === "function" ? (request) => reader.call(bot, request) : null,
    commitTurnLifecycle,
    userId,
    sessionId,
    parentSessionId,
    commandId,
    terminalLimit,
  });
}

export async function recoverSnapshotOrphan({
  bot,
  commitTurnLifecycle,
  inspectExecution,
  userId,
  sessionId,
  parentSessionId = "",
  commandId,
  terminalLimit,
} = {}) {
  const reader = bot?.getTurnLifecycleSnapshot;
  if (typeof reader !== "function") {
    return { recovered: false, reason: "lifecycle_snapshot_unavailable" };
  }
  const request = { userId, sessionId, parentSessionId, commandId, terminalLimit };
  const initial = await reader.call(bot, request);
  if (!initial?.found) {
    return { recovered: false, reason: initial?.reason || "snapshot_not_found", result: initial };
  }
  const recovered = await recoverAuthoritativeOrphanedTurn({
    snapshot: initial.snapshot,
    identity: { userId, sessionId, parentSessionId },
    inspectExecution,
    commitTurnLifecycle,
  });
  return recovered.recovered
    ? { ...recovered, result: await reader.call(bot, request) }
    : { ...recovered, result: initial };
}
