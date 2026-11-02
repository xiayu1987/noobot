/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionPersistenceScope } from "@noobot/session-protocol";

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
      persistenceScope: scope,
    });
    if (!result.applied && !result.deduplicated) return result;
    const dispatch = await dispatchAuthorityEvents({
      userId: event.userId,
      sessionId: event.sessionId,
      persistenceScope: scope,
    });
    return { ...result, dispatch };
  };
}
