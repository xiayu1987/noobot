/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  resolveLatestContinuableStoppedTurn,
  selectCurrentTurnRuntime,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";
import {
  reduceTurnRuntimeEvent as reduceNormalizedTurnRuntimeEvent,
  TURN_TRANSITION_REASON,
} from "../../../../../../src/modules/chat/runtime/run-state-machine/turnReducer.js";
import { SESSION_RUN_EVENT } from "../../../../../../src/modules/chat/runtime/run-state-machine/constants.js";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol";
import { normalizeSessionRunEvent } from "../../../../../../src/modules/chat/runtime/run-state-machine/eventNormalization.js";

const reduceTurnRuntimeEvent = (current, rawEvent) =>
  reduceNormalizedTurnRuntimeEvent(current, normalizeSessionRunEvent(rawEvent));

function registryWith(turns) {
  return {
    sessions: {
      s1: {
        activeTurnScopeId: "",
        turns: Object.fromEntries(
          turns.map((turn) => [turn.turnScopeId, { sessionId: "s1", ...turn }]),
        ),
      },
    },
  };
}

describe("turn runtime sequence", () => {
  it("orders turns by lifecycle sequence only", () => {
    const registry = registryWith([
      { turnScopeId: "older", state: "processing", lifecycleSeq: 0, seq: 99, updatedAtMs: 1 },
      { turnScopeId: "newer", state: "processing", lifecycleSeq: 5, updatedAtMs: 1 },
    ]);
    expect(selectCurrentTurnRuntime(registry, "s1")?.turnScopeId).toBe("newer");
  });

  it("orders stopped turns by lifecycle sequence only", () => {
    const registry = registryWith([
      { turnScopeId: "older", terminal: "user_stopped", lifecycleSeq: 0, seq: 99, finishedAtMs: 1 },
      { turnScopeId: "newer", terminal: "user_stopped", lifecycleSeq: 5, finishedAtMs: 1 },
    ]);
    expect(resolveLatestContinuableStoppedTurn(registry, "s1")?.turnScopeId).toBe("newer");
  });

  it("tracks lifecycle sequence without a duplicate turn seq", () => {
    const identity = { sessionId: "s1", turnScopeId: "t1", dialogProcessId: "dp1" };
    const accepted = reduceTurnRuntimeEvent(null, {
      ...identity,
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      state: TURN_STATE.ACTION_REQUESTING,
      phase: TURN_PHASE.ACTION,
      action: "send",
      seq: 4,
    });
    expect(accepted.applied).toBe(true);
    expect(accepted.next.lifecycleSeq).toBe(4);
    expect(accepted.next).not.toHaveProperty("seq");
    expect(
      reduceTurnRuntimeEvent(accepted.next, {
        ...identity,
        type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
        eventType: TURN_EVENT.ACTION_ACCEPTED,
        state: TURN_STATE.ACTION_REQUESTING,
        phase: TURN_PHASE.ACTION,
        action: "send",
        seq: 3,
      }),
    ).toMatchObject({ applied: false, reason: TURN_TRANSITION_REASON.STALE_SEQUENCE });
  });
});
