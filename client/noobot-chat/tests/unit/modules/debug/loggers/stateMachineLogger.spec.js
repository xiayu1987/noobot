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
    const sink = { debug: vi.fn((_debugType, factory) => factory()), isEnabled: () => true };
    setStateMachineDebugLogSink(sink);

    logStateMachineDebug("stateMachine.reducer.decision", () => ({
      sessionId: "s-1",
      turnScopeId: "t-1",
      applied: false,
      reason: "stale_revision",
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
      type: "local_user_stop_requested",
      eventType: "turn.stop_requested",
      sessionId: "s-1",
      turnScopeId: "t-1",
      revision: 4,
      seq: 7,
      content: "private event body",
      raw: { message: "private raw body" },
    });
    const turn = summarizeStateMachineTurn(
      {
        sessionId: "s-1",
        turnScopeId: "t-1",
        state: "completed",
        revision: 4,
        lifecycleSeq: 7,
        terminalResolved: true,
        terminalMaterialization: { messages: [{ content: "private message body" }] },
      },
      { displayState: "completed", sending: false, canStop: false },
    );

    expect(event).toMatchObject({
      lifecycleEventType: "turn.stop_requested",
      revision: 4,
      sequence: 7,
    });
    expect(turn).toMatchObject({
      state: "completed",
      terminalResolved: true,
      revision: 4,
      sequence: 7,
    });
    expect(JSON.stringify({ event, turn })).not.toContain("private");
  });

  it("reads identity only from the normalized top level, never from raw", () => {
    const event = summarizeStateMachineEvent({
      type: "local_reset",
      raw: {
        sessionId: "raw-session",
        turnScopeId: "raw-turn",
        commandId: "raw-command",
        source: "raw-source",
        seq: 9,
        sequence: 9,
      },
    });

    expect(event).toMatchObject({
      sessionId: "",
      turnScopeId: "",
      commandId: "",
      source: "",
      sequence: 0,
    });
  });
});
