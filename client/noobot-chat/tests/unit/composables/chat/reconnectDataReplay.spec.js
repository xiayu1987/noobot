/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { applyReconnectDataReplay } from "../../../../src/composables/chat/reconnectReplay/reconnectDataReplay";

function createFixture(overrides = {}) {
  return {
    ensureReconnectSessionActive: vi.fn(async () => {}),
    isCurrentActiveSession: vi.fn((sessionId) => sessionId === "s-1"),
    resolveReconnectTargetAssistantMessage: vi.fn(),
    replayCache: {},
    applyReconnectMessagesToActiveSession: vi.fn(async () => {}),
    applyChannelState: vi.fn(),
    scheduleCacheExpiredSessionRefresh: vi.fn(),
    reconcileSessionState: vi.fn(async () => true),
    ...overrides,
  };
}

describe("applyReconnectDataReplay", () => {
  it("applies active session replay messages with recoverable allowCreate", async () => {
    const fixture = createFixture();
    const messages = [
      { event: "delta", data: { seq: 1, text: "hello", dialogProcessId: "dp-1" } },
    ];

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            currentRun: { sessionId: "s-1", dialogProcessId: "dp-1", turnScopeId: "turn-1", state: "sending", seq: 1 },
            dialogProcesses: [{ dialogProcessId: "dp-1", messages }],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.applyReconnectMessagesToActiveSession).toHaveBeenCalledWith(
      messages,
      "dp-1",
      { allowCreate: true, turnScopeId: "turn-1" },
    );
    expect(fixture.replayCache).toEqual({});
  });

  it("caches non-active session replay messages by dialog process id", async () => {
    const fixture = createFixture({
      isCurrentActiveSession: vi.fn(() => false),
    });
    const messages = [
      { event: "delta", data: { seq: 1, text: "cached", dialogProcessId: "dp-2" } },
    ];

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: " s-2 ",
            hasRunningTask: true,
            currentRun: { sessionId: "s-2", dialogProcessId: "dp-2", turnScopeId: "turn-2", state: "sending", seq: 1 },
            dialogProcesses: [{ dialogProcessId: " dp-2 ", messages }],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.applyReconnectMessagesToActiveSession).not.toHaveBeenCalled();
    expect(fixture.replayCache).toEqual({
      "s-2": {
        "dp-2": messages,
      },
    });
  });

  it("applies currentRun and schedules cache expired refresh", async () => {
    const fixture = createFixture();
    const stateEntry = { sessionId: "s-1", dialogProcessId: "dp-state", turnScopeId: "turn-state", state: "sending" };

    await applyReconnectDataReplay({
      reconnectData: {
        cacheExpired: true,
        sessions: [
          {
            sessionId: "s-1",
            currentRun: stateEntry,
            conversationStates: [stateEntry],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.applyChannelState).toHaveBeenCalledWith({
      ...stateEntry,
      authoritativeSnapshot: true,
    });
    expect(fixture.scheduleCacheExpiredSessionRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not project conversationStates when currentRun is missing", async () => {
    const fixture = createFixture();

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [{
          sessionId: "s-1",
          hasRunningTask: false,
          conversationStates: [
            { sessionId: "s-1", dialogProcessId: "dp-old", turnScopeId: "turn-old", state: "user_stopped", seq: 12 },
          ],
          dialogProcesses: [],
        }],
      },
      ...fixture,
    });

    expect(fixture.applyChannelState).not.toHaveBeenCalled();
    expect(fixture.reconcileSessionState).toHaveBeenCalledWith({
      sessionId: "s-1",
      hasRunningTask: false,
      reason: "invalid_current_run",
    });
  });


  it("restores running channel with only session-scope turnScopeId state as stoppable", async () => {
    const applyRunStateEvents = vi.fn();
    const fixture = createFixture({ applyRunStateEvents });

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            currentRun: { sessionId: "s-1", dialogProcessId: "", turnScopeId: "client-turn-r", state: "sending", seq: 0 },
            conversationStates: [
              { sessionId: "s-1", dialogProcessId: "", turnScopeId: "client-turn-r", state: "sending", seq: 0 },
            ],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.ensureReconnectSessionActive).toHaveBeenCalledWith("s-1");
    expect(applyRunStateEvents).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({
        type: "backend_channel_state",
        state: "sending",
        sessionId: "s-1",
        dialogProcessId: "",
        turnScopeId: "client-turn-r",
      }),
    ]));
  });

  it("ignores historical stopped turns when reconnect declares an active running turn", async () => {
    const appliedEvents = [];
    const appliedChannelStates = [];
    const fixture = createFixture({
      applyRunStateEvents: vi.fn((events) => appliedEvents.push(...events)),
      applyChannelState: vi.fn(async (stateEntry) => appliedChannelStates.push(stateEntry)),
    });

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [{
          sessionId: "s-1",
          hasRunningTask: true,
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-current",
            turnScopeId: "turn-current",
            state: "sending",
            seq: 80,
          },
          conversationStates: [
            { sessionId: "s-1", dialogProcessId: "dp-old-1", turnScopeId: "turn-old-1", state: "user_stopped", seq: 31 },
            { sessionId: "s-1", dialogProcessId: "dp-current", turnScopeId: "turn-current", state: "sending", seq: 12 },
            { sessionId: "s-1", dialogProcessId: "dp-old-2", turnScopeId: "turn-old-2", state: "user_stopped", seq: 34 },
            { sessionId: "s-1", dialogProcessId: "", turnScopeId: "turn-current", state: "sending", seq: 80 },
          ],
          dialogProcesses: [],
        }],
      },
      ...fixture,
    });

    expect(appliedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "sending", turnScopeId: "turn-current" }),
    ]));
    expect(appliedEvents.some((event) => event.state === "user_stopped")).toBe(false);
    expect(appliedChannelStates).toHaveLength(1);
    expect(appliedChannelStates.every((state) => state.turnScopeId === "turn-current")).toBe(true);
    expect(appliedChannelStates[0]).toEqual(expect.objectContaining({
      sessionId: "s-1",
      dialogProcessId: "dp-current",
      turnScopeId: "turn-current",
      state: "sending",
      seq: 80,
    }));
  });

  it("uses the completed current run instead of a historical stopped turn", async () => {
    const appliedEvents = [];
    const appliedChannelStates = [];
    const fixture = createFixture({
      applyRunStateEvents: vi.fn((events) => appliedEvents.push(...events)),
      applyChannelState: vi.fn(async (stateEntry) => appliedChannelStates.push(stateEntry)),
    });

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [{
          sessionId: "s-1",
          hasRunningTask: false,
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-current",
            turnScopeId: "turn-current",
            state: "completed",
            seq: 198,
          },
          conversationStates: [
            { sessionId: "s-1", dialogProcessId: "dp-old", turnScopeId: "turn-old", state: "user_stopped", seq: 123 },
            { sessionId: "s-1", dialogProcessId: "dp-current", turnScopeId: "turn-current", state: "completed", seq: 198 },
          ],
          dialogProcesses: [],
        }],
      },
      ...fixture,
    });

    expect(appliedEvents).toEqual([]);
    expect(appliedChannelStates).toEqual([
      expect.objectContaining({
        state: "completed",
        dialogProcessId: "dp-current",
        turnScopeId: "turn-current",
        authoritativeSnapshot: true,
      }),
    ]);
  });

  it("restores stopped state after recoverable reconnect data replay", async () => {
    const fixture = createFixture();

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: false,
            currentRun: { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "user_stopped", seq: 12 },
            conversationStates: [
              { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "sending", seq: 11 },
              { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "user_stopped", seq: 12 },
            ],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

  });

  it("does not resurrect a terminal currentRun when channel running lags behind", async () => {
    const appliedEvents = [];
    const appliedChannelStates = [];
    const fixture = createFixture({
      applyRunStateEvents: vi.fn((events) => appliedEvents.push(...events)),
      applyChannelState: vi.fn(async (stateEntry) => appliedChannelStates.push(stateEntry)),
    });

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [{
          sessionId: "s-1",
          hasRunningTask: true,
          currentRun: {
            sessionId: "s-1",
            dialogProcessId: "dp-stop",
            turnScopeId: "turn-stop",
            state: "user_stopped",
            seq: 12,
          },
          conversationStates: [],
          dialogProcesses: [],
        }],
      },
      ...fixture,
    });

    expect(fixture.ensureReconnectSessionActive).not.toHaveBeenCalled();
    expect(appliedEvents.some((event) => event.type === "backend_recoverable_running")).toBe(false);
    expect(appliedChannelStates).toEqual([
      expect.objectContaining({
        state: "user_stopped",
        dialogProcessId: "dp-stop",
        turnScopeId: "turn-stop",
      }),
    ]);
  });

  it("restores stopping as in-flight but not stoppable after recoverable replay", async () => {
    const fixture = createFixture();

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            currentRun: { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "stopping", seq: 12 },
            conversationStates: [
              { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "stopping", seq: 12 },
            ],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.ensureReconnectSessionActive).toHaveBeenCalledWith("s-1");
    expect(fixture.applyChannelState).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s-1",
      turnScopeId: "turn-stop",
      state: "stopping",
      authoritativeSnapshot: true,
    }));
  });

  it.each(["cancelled", "completed", "error", "expired", "no_conversation"])(
    "restores terminal %s as not sending and not stoppable",
    async (terminalState) => {
      const fixture = createFixture();

      await applyReconnectDataReplay({
        reconnectData: {
          sessions: [
            {
              sessionId: "s-1",
              hasRunningTask: false,
              currentRun: { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: terminalState, seq: 12 },
              conversationStates: [
                { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "sending", seq: 11 },
                { sessionId: "s-1", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: terminalState, seq: 12 },
              ],
              dialogProcesses: [],
            },
          ],
        },
        ...fixture,
      });

    },
  );
});
