/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionPersistenceScope } from "@noobot/session-protocol";
import { text as clean } from "@noobot/shared/value";

export function createTurnLifecycleBridge({
  resolveBot,
  dispatchAuthorityEvents,
  persistenceScope,
}) {
  const scope = createSessionPersistenceScope(persistenceScope);
  return async function commitTurnLifecycle(event) {
    if (Object.hasOwn(event, "persistenceScope")) {
      throw new TypeError("turn lifecycle event must not carry persistenceScope");
    }
    const result = await resolveBot().session.applyTurnLifecycleEvent({
      ...event,
      userId: clean(event.userId),
      sessionId: clean(event.sessionId),
      turnScopeId: clean(event.turnScopeId),
      commandId: clean(event.commandId),
      persistenceScope: scope,
    });
    if (!result.applied && !result.deduplicated) return result;
    if (!result.turn) return { ...result, applied: false, reason: "lifecycle_turn_missing" };
    if (!result.envelope) {
      return { ...result, applied: false, reason: "lifecycle_envelope_missing" };
    }
    const dispatch = await dispatchAuthorityEvents({
      userId: event.userId,
      sessionId: event.sessionId,
      persistenceScope: scope,
    });
    return { ...result, dispatch };
  };
}
