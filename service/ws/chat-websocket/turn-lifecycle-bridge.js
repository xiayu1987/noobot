/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export function createTurnLifecycleBridge({ resolveBot, dispatchAuthorityEvents } = {}) {
  return async function commitTurnLifecycle(event = {}) {
    const bot = resolveBot();
    const applyLifecycle = bot?.applyTurnLifecycleEvent;
    if (typeof applyLifecycle !== "function") {
      throw new Error("applyTurnLifecycleEvent is required");
    }
    const result = await applyLifecycle.call(bot, {
      ...event,
      userId: clean(event.userId),
      sessionId: clean(event.sessionId),
      turnScopeId: clean(event.turnScopeId),
      commandId: clean(event.commandId),
    });
    if (!result?.applied && !result?.deduplicated) return result || { applied: false, reason: "lifecycle_unavailable" };
    const turn = result.turn;
    if (!turn) return { ...result, applied: false, reason: "lifecycle_turn_missing" };
    if (!result.envelope) return { ...result, applied: false, reason: "lifecycle_envelope_missing" };
    const dispatch = typeof dispatchAuthorityEvents === "function"
      ? await dispatchAuthorityEvents({
        userId: event.userId,
        sessionId: event.sessionId,
        parentSessionId: event.parentSessionId,
      })
      : { dispatched: false, reason: "authority_dispatcher_unavailable" };
    return { ...result, dispatch };
  };
}
