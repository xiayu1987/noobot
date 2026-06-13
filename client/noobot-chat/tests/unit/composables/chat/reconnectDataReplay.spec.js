import { describe, expect, it, vi } from "vitest";
import { applyReconnectDataReplay } from "../../../../src/composables/chat/reconnectReplay/reconnectDataReplay";

function createFixture(overrides = {}) {
  return {
    ensureReconnectSessionActive: vi.fn(async () => {}),
    sending: { value: false },
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
});
