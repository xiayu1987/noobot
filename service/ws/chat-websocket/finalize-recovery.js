/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recoverTurnFinalize as recoverAuthoritativeTurnFinalize } from "@noobot/authoritative-state/application";

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
