/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { installSessionLifecycleHydration } from "../../../../../../src/modules/chat/runtime/session/sessionLifecycleHydration.js";

describe("sessionLifecycleHydration", () => {
  it("does not manufacture an Agent persistence scope during active-turn discovery", () => {
    const scheduleTerminalResolution = vi.fn();
    const session = {
      sessionId: "session-1",
      parentSessionId: "parent-1",
      messages: [],
      turnTimings: [],
      turnLifecycleSnapshot: {
        sessionId: "session-1",
        sequence: 2,
        activeTurnScopeId: "turn-1",
        activeTurn: {
          turnScopeId: "turn-1",
          state: "processing",
          phase: "processing",
          executionState: "sending",
          revision: 2,
          sequence: 2,
        },
        recentTerminalTurns: [],
        replacedTurns: [],
      },
    };
    const chatStore = {
      applyTurnTimingSnapshot: vi.fn(() => ({ applied: true })),
      applyTurnLifecycleSnapshot: vi.fn(() => ({ applied: true })),
      pruneTerminalTurns: vi.fn(),
    };

    installSessionLifecycleHydration({
      sessions: ref([session]),
      activeSessionId: ref("session-1"),
      chatStore,
      scheduleTerminalResolution,
    });

    expect(scheduleTerminalResolution).toHaveBeenCalledOnce();
    expect(scheduleTerminalResolution).toHaveBeenCalledWith(
      "session-1",
      "turn-1",
      expect.objectContaining({
        source: "authoritative_active_turn_hydration",
        revision: 2,
        sequence: 2,
      }),
    );
    expect(scheduleTerminalResolution.mock.calls[0][2]).not.toHaveProperty("persistenceScope");
  });
});
