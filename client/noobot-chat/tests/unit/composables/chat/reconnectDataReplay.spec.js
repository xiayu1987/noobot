import { describe, expect, it, vi } from "vitest";
import { applyReconnectDataReplay } from "../../../../src/composables/chat/reconnectReplay/reconnectDataReplay";

function createFixture(overrides = {}) {
  return {
    ensureReconnectSessionActive: vi.fn(async () => {}),
    sending: { value: false },
    canStop: { value: false },
    isCurrentActiveSession: vi.fn((sessionId) => sessionId === "s-1"),
    resolveReconnectTargetAssistantMessage: vi.fn(),
    replayCache: {},
    applyReconnectMessagesToActiveSession: vi.fn(async () => {}),
    applyChannelState: vi.fn(),
    scheduleCacheExpiredSessionRefresh: vi.fn(),
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
            dialogProcesses: [{ dialogProcessId: "dp-1", messages }],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.applyReconnectMessagesToActiveSession).toHaveBeenCalledWith(
      messages,
      "dp-1",
      { allowCreate: true },
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

  it("applies conversation states and schedules cache expired refresh", async () => {
    const fixture = createFixture();
    const stateEntry = { sessionId: "s-1", dialogProcessId: "dp-state", state: "sending" };

    await applyReconnectDataReplay({
      reconnectData: {
        cacheExpired: true,
        sessions: [
          {
            sessionId: "s-1",
            conversationStates: [stateEntry],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.applyChannelState).toHaveBeenCalledWith(stateEntry);
    expect(fixture.scheduleCacheExpiredSessionRefresh).toHaveBeenCalledTimes(1);
  });


  it("restores running channel with only session-scope turnScopeId state as stoppable", async () => {
    let fixture;
    const applyRunStateEvents = vi.fn((events) => {
      const latest = events.at(-1);
      fixture.sending.value = latest?.state === "sending" || latest?.state === "reconnecting";
      fixture.canStop.value = latest?.state === "sending" || latest?.state === "reconnecting";
    });
    fixture = createFixture({ applyRunStateEvents });

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
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
    expect(fixture.sending.value).toBe(true);
    expect(fixture.canStop.value).toBe(true);
  });

  it("restores stopped state after recoverable reconnect data replay", async () => {
    const fixture = createFixture();

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            conversationStates: [
              { sessionId: "s-1", dialogProcessId: "dp-stop", state: "sending", seq: 11 },
              { sessionId: "s-1", dialogProcessId: "dp-stop", state: "stopped", seq: 12 },
            ],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.ensureReconnectSessionActive).toHaveBeenCalledWith("s-1");
    expect(fixture.sending.value).toBe(false);
    expect(fixture.canStop.value).toBe(false);
  });

  it("restores stopping as in-flight but not stoppable after recoverable replay", async () => {
    const fixture = createFixture();

    await applyReconnectDataReplay({
      reconnectData: {
        sessions: [
          {
            sessionId: "s-1",
            hasRunningTask: true,
            conversationStates: [
              { sessionId: "s-1", dialogProcessId: "dp-stop", state: "stopping", seq: 12 },
            ],
            dialogProcesses: [],
          },
        ],
      },
      ...fixture,
    });

    expect(fixture.ensureReconnectSessionActive).toHaveBeenCalledWith("s-1");
    expect(fixture.sending.value).toBe(true);
    expect(fixture.canStop.value).toBe(false);
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
              hasRunningTask: true,
              conversationStates: [
                { sessionId: "s-1", dialogProcessId: "dp-stop", state: "sending", seq: 11 },
                { sessionId: "s-1", dialogProcessId: "dp-stop", state: terminalState, seq: 12 },
              ],
              dialogProcesses: [],
            },
          ],
        },
        ...fixture,
      });

      expect(fixture.sending.value).toBe(false);
      expect(fixture.canStop.value).toBe(false);
    },
  );
});
