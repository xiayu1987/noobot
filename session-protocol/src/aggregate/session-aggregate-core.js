/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeCommandReceipts } from "../command/command-receipt.js";
import { normalizeTurnTimings } from "../lifecycle/turn-timing.js";

export function normalizeSessionAggregateCore(session = {}) {
  const lifecycle =
    session.turnLifecycle && typeof session.turnLifecycle === "object" ? session.turnLifecycle : {};
  return {
    sessionId: String(session.sessionId || "").trim(),
    parentSessionId: String(session.parentSessionId || "").trim(),
    aggregateVersion: Math.max(0, Number(session.aggregateVersion) || 0),
    messages: Array.isArray(session.messages) ? session.messages : [],
    turnTimings: normalizeTurnTimings(session.turnTimings),
    turnLifecycle: {
      ...lifecycle,
      commandReceipts: normalizeCommandReceipts(lifecycle.commandReceipts),
    },
  };
}
