/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { installSessionLifecycleHydration } from "../../../../../../src/modules/chat/runtime/session/sessionLifecycleHydration.js";

describe("sessionLifecycleHydration", () => {
  function setup() {
    const sessions = ref([
      {
        sessionId: "session-1",
        messages: [
          { role: "assistant", turnScopeId: "turn-1", content: "a", activityTimeline: [] },
        ],
        turnTimings: [],
        turnLifecycleSnapshot: { sessionId: "session-1", sequence: 1 },
      },
    ]);
    const chatStore = {
      applyTurnTimingSnapshot: vi.fn(() => ({ applied: true })),
      applyTurnLifecycleSnapshot: vi.fn(() => ({ applied: true })),
      pruneTerminalTurns: vi.fn(),
    };
    installSessionLifecycleHydration({
      sessions,
      activeSessionId: ref("session-1"),
      chatStore,
      scheduleTerminalResolution: vi.fn(),
    });
    chatStore.applyTurnLifecycleSnapshot.mockClear();
    chatStore.applyTurnTimingSnapshot.mockClear();
    chatStore.pruneTerminalTurns.mockClear();
    return { sessions, chatStore };
  }

  it("does not re-hydrate when streaming deltas mutate message content", async () => {
    const { sessions, chatStore } = setup();
    const message = sessions.value[0].messages[0];
    for (let index = 0; index < 20; index += 1) {
      message.content += "x";
      message.activityTimeline.push({ type: "activity_delta", text: String(index) });
      await nextTick();
    }
    expect(chatStore.applyTurnLifecycleSnapshot).not.toHaveBeenCalled();
    expect(chatStore.applyTurnTimingSnapshot).not.toHaveBeenCalled();
    expect(chatStore.pruneTerminalTurns).not.toHaveBeenCalled();
  });

  it("re-hydrates when the authoritative snapshot, timings or turn references change", async () => {
    const { sessions, chatStore } = setup();
    sessions.value[0].turnLifecycleSnapshot = { sessionId: "session-1", sequence: 2 };
    await nextTick();
    expect(chatStore.applyTurnLifecycleSnapshot).toHaveBeenCalledTimes(1);

    sessions.value[0].turnTimings = [{ turnScopeId: "turn-1" }];
    await nextTick();
    expect(chatStore.applyTurnTimingSnapshot).toHaveBeenCalledTimes(2);

    sessions.value[0].messages.push({ role: "user", turnScopeId: "turn-2", content: "b" });
    await nextTick();
    expect(chatStore.pruneTerminalTurns).toHaveBeenCalledTimes(3);
    expect(chatStore.pruneTerminalTurns).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      referencedTurnScopeIds: ["turn-1", "turn-2"],
    });

    sessions.value = [...sessions.value, { sessionId: "session-2", messages: [] }];
    await nextTick();
    expect(chatStore.pruneTerminalTurns).toHaveBeenCalledTimes(5);
  });

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
