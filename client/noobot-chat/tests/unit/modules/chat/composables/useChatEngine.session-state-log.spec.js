/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { createHarness } from "../helpers/useChatEngineHarness.js";
import { SESSION_RUN_EVENT } from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";

function stateLogRecords(log) {
  return log.mock.calls
    .map(([record]) => record)
    .filter((record) => String(record?.event || "").startsWith("stateMachine."));
}

describe("useChatEngine session state log identity", () => {
  it("never attributes an event without sessionId to the active session", () => {
    const log = vi.fn();
    const { engine } = createHarness({
      sessionId: "s-active",
      deps: { sessionLogWebSocketClient: { log } },
    });

    expect(() =>
      engine.dispatchAuthoritativeRunStateEvent({ type: SESSION_RUN_EVENT.LOCAL_RESET }),
    ).not.toThrow();

    expect(stateLogRecords(log)).toEqual([]);
  });

  it("records only the identity the event declares", () => {
    const log = vi.fn();
    const { engine } = createHarness({
      sessionId: "s-active",
      deps: { sessionLogWebSocketClient: { log } },
    });

    engine.dispatchAuthoritativeRunStateEvent({
      type: SESSION_RUN_EVENT.LOCAL_RESET,
      sessionId: "s-event",
      dialogProcessId: "dp-event",
      turnScopeId: "turn-event",
    });

    const records = stateLogRecords(log);
    expect(records.map((record) => record.event)).toEqual([
      "stateMachine.event",
      "stateMachine.transition",
    ]);
    for (const record of records) {
      expect(record).toMatchObject({
        scope: "session",
        category: "state",
        sessionId: "s-event",
        dialogProcessId: "dp-event",
        turnScopeId: "turn-event",
      });
    }
  });

  it("routes every run-state event through the turn reducer, never the lifecycle envelope", () => {
    const applyTurnRuntimeEvent = vi.fn(() => ({ applied: false, reason: "test" }));
    const applyTurnLifecycleEnvelope = vi.fn();
    const { engine } = createHarness({
      sessionId: "s-active",
      deps: { applyTurnRuntimeEvent, applyTurnLifecycleEnvelope },
    });
    const event = {
      type: SESSION_RUN_EVENT.BACKEND_TURN_LIFECYCLE,
      sessionId: "s-event",
      turnScopeId: "turn-event",
      raw: { sessionId: "s-event", turnScopeId: "turn-event" },
    };

    engine.dispatchAuthoritativeRunStateEvent(event);

    expect(applyTurnRuntimeEvent).toHaveBeenCalledWith(event);
    expect(applyTurnLifecycleEnvelope).not.toHaveBeenCalled();
  });
});
