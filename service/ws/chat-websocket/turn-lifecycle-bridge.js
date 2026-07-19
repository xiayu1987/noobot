/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import {
  TURN_LIFECYCLE_WIRE_EVENT,
  createTurnLifecycleEnvelope,
  deriveAuthoritativeTurnCapabilities,
} from "@noobot/shared/turn-lifecycle-protocol";

const clean = (value) => String(value || "").trim();

/** Persist one authoritative lifecycle fact and emit exactly that committed fact. */
export function createTurnLifecycleBridge({ resolveBot, sendEvent } = {}) {
  return async function commitTurnLifecycle(event = {}) {
    const bot = resolveBot();
    const applyLifecycle = bot?.applyTurnLifecycleEvent;
    // Rolling-upgrade compatibility: an older Agent does not understand the
    // v1 lifecycle protocol. Keep the legacy wire path alive without claiming
    // that an authoritative event was committed. Once capability negotiation
    // says v1 is available, callers receive a real applied/rejected result.
    if (typeof applyLifecycle !== "function") {
      return {
        applied: true,
        skipped: true,
        legacy: true,
        reason: "lifecycle_protocol_unavailable",
      };
    }
    const result = await applyLifecycle.call(bot, {
      ...event,
      userId: clean(event.userId),
      sessionId: clean(event.sessionId),
      turnScopeId: clean(event.turnScopeId),
      commandId: clean(event.commandId),
    });
    if (!result?.applied && !result?.deduplicated) return result || { applied: false, reason: "lifecycle_unavailable" };
    // A duplicate is an idempotent acknowledgement, not a newly committed
    // domain event. Never mint a new eventId/sequence for it.
    if (result?.deduplicated) return result;
    const turn = result.turn;
    if (!turn) return { ...result, applied: false, reason: "lifecycle_turn_missing" };
    const envelope = createTurnLifecycleEnvelope({
      eventType: event.eventType,
      eventId: randomUUID(),
      commandId: event.commandId,
      causationId: event.causationId || event.commandId,
      correlationId: event.correlationId || event.turnScopeId,
      userId: event.userId,
      sessionId: event.sessionId,
      turnScopeId: event.turnScopeId,
      dialogProcessId: turn.dialogProcessId || event.dialogProcessId,
      revision: turn.revision,
      sequence: turn.sequence,
      phase: turn.phase,
      state: turn.state,
      action: turn.action,
      executionState: turn.executionState,
      summaryVersion: turn.summaryVersion,
      updatedAt: turn.updatedAt,
      occurredAt: turn.updatedAt,
      capabilities: deriveAuthoritativeTurnCapabilities(turn),
      failure: turn.failure,
      payload: event.payload,
    });
    sendEvent(TURN_LIFECYCLE_WIRE_EVENT, envelope);
    return { ...result, envelope };
  };
}
