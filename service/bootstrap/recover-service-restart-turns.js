/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createServiceRestartRecoveryPolicy } from "@noobot/authoritative-state/application";
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { SESSION_SUMMARY_AVAILABILITY } from "@noobot/session-protocol/sessions-summary";
import { finalizeTurnSnapshot } from "../ws/chat-websocket/turn-recovery.js";
import { readServiceClockMs } from "../ws/chat-websocket/service-clock.js";

const TREE_SESSION_PERSISTENCE_SCOPE = createSessionPersistenceScope(null);

function isActiveAvailableSummary(summary) {
  return (
    summary.availability === SESSION_SUMMARY_AVAILABILITY.AVAILABLE &&
    summary.activeTurnScopeId !== ""
  );
}

function recoverSessionTurn(bot, identity, observedAtMs) {
  return finalizeTurnSnapshot({
    ...identity,
    ...createServiceRestartRecoveryPolicy({ observedAtMs }),
    bot,
    commitTurnLifecycle: (event) =>
      bot.session.applyTurnLifecycleEvent({
        ...event,
        persistenceScope: TREE_SESSION_PERSISTENCE_SCOPE,
      }),
    commandId: `service-restart-recovery:${identity.sessionId}`,
    terminalLimit: 0,
    persistenceScope: TREE_SESSION_PERSISTENCE_SCOPE,
  });
}

export async function recoverServiceRestartTurns({ bot, userId, onProgress }) {
  const { sessions } = await bot.session.getAllSessionSummaries({ userId });
  const active = sessions.filter(isActiveAvailableSummary);
  const recoveredSessionIds = [];
  const failures = [];
  for (const [index, { sessionId }] of active.entries()) {
    onProgress({ sessionIndex: index + 1, sessionCount: active.length });
    const outcome = await recoverSessionTurn(bot, { userId, sessionId }, readServiceClockMs(bot));
    if (outcome.recovered) recoveredSessionIds.push(sessionId);
    else failures.push({ sessionId, code: outcome.reason });
  }
  return { recoveredSessionIds, failures };
}
