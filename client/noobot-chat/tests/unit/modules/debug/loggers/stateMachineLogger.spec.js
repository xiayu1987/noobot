/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  logStateMachineDebug,
  setStateMachineDebugLogSink,
  summarizeStateMachineEvent,
  summarizeStateMachineTurn,
} from "../../../../../src/modules/debug/loggers/stateMachineLogger.js";

describe("stateMachineLogger", () => {
  beforeEach(() => setStateMachineDebugLogSink(null));

  it("emits lazy state-machine diagnostics through the centralized policy", () => {
    const sink = { debug: vi.fn((debugType, factory) => factory()), isEnabled: () => true };
    setStateMachineDebugLogSink(sink);

    logStateMachineDebug("stateMachine.reducer.decision", () => ({
      sessionId: "s-1", turnScopeId: "t-1", applied: false, reason: "stale_revision",
    }));

    expect(sink.debug).toHaveBeenCalledWith("state-machine", expect.any(Function));
    expect(sink.debug.mock.results[0].value).toMatchObject({
      event: "stateMachine.reducer.decision",
      sessionId: "s-1",
      turnScopeId: "t-1",
      data: { applied: false, reason: "stale_revision" },
    });
  });

  it("summarizes identity and state without serializing message or event bodies", () => {
    const event = summarizeStateMachineEvent({
      type: "backend_turn_lifecycle", eventType: "turn.completed",
      sessionId: "s-1", turnScopeId: "t-1", revision: 4, sequence: 7,
      content: "private event body", raw: { message: "private raw body" },
    });
    const turn = summarizeStateMachineTurn({
      sessionId: "s-1", turnScopeId: "t-1", state: "completed",
      revision: 4, seq: 7, terminalResolved: true,
      terminalMaterialization: { messages: [{ content: "private message body" }] },
    }, { displayState: "completed", sending: false, canStop: false });

    expect(event).toMatchObject({ lifecycleEventType: "turn.completed", revision: 4, sequence: 7 });
    expect(turn).toMatchObject({ state: "completed", terminalResolved: true, revision: 4, sequence: 7 });
    expect(JSON.stringify({ event, turn })).not.toContain("private");
  });
});
