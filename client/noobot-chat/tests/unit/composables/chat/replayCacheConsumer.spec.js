import { describe, expect, it, vi } from "vitest";
import {
  applyReconnectMessagesToActiveSessionReplay,
  consumeReconnectReplayCacheForSession,
  markReconnectSequenceApplied,
} from "../../../../src/composables/chat/reconnectReplay/replayCacheConsumer";
import { StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

function createActiveReplayFixture(overrides = {}) {
  const activeSession = {
    value: {
      messages: [
        { role: "assistant", dialogProcessId: "dp-1", content: "", pending: true },
      ],
    },
  };

  return {
    activeSession,
    activeSessionId: { value: "s-1" },
    appendMessage: vi.fn((message) => activeSession.value.messages.push(message)),
    chatList: { value: [] },
    appliedReconnectSeqByDialogProcessId: {},
    terminalDialogProcessIdSet: new Set(),
    classifyRealtimeLog: vi.fn((logItem) => logItem),
    getReplayHydrationPromise: vi.fn(() => null),
    setReplayHydrationPromise: vi.fn(),
    applyDoneMessages: vi.fn(),
    envelopeCallbacks: {},
    markReconnectSequenceApplied: vi.fn(),
    scrollBottom: vi.fn(),
    ...overrides,
  };
}

describe("replayCacheConsumer", () => {
  it("consumes cached replay groups for a session and removes the session cache", async () => {
    const replayCache = {
      "s-1": {
        "dp-1": [{ event: StreamEventEnum.DELTA, data: { text: "a" } }],
        "__session__s-1": [{ event: StreamEventEnum.DELTA, data: { text: "b" } }],
      },
      "s-2": {
        "dp-2": [{ event: StreamEventEnum.DELTA, data: { text: "c" } }],
      },
    };
    const applyReconnectMessagesToActiveSession = vi.fn(async () => {});

    await consumeReconnectReplayCacheForSession({
      replayCache,
      sessionId: " s-1 ",
      applyReconnectMessagesToActiveSession,
    });

    expect(applyReconnectMessagesToActiveSession).toHaveBeenCalledTimes(2);
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(
      1,
      [{ event: StreamEventEnum.DELTA, data: { text: "a" } }],
      "dp-1",
    );
    expect(applyReconnectMessagesToActiveSession).toHaveBeenNthCalledWith(
      2,
      [{ event: StreamEventEnum.DELTA, data: { text: "b" } }],
      "",
    );
    expect(replayCache).toEqual({
      "s-2": {
        "dp-2": [{ event: StreamEventEnum.DELTA, data: { text: "c" } }],
      },
    });
  });

  it("marks reconnect sequence only when the incoming sequence is newer", () => {
    const appliedReconnectSeqByDialogProcessId = { "dp-1": 5 };

    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, " dp-1 ", 3);
    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, " dp-1 ", 8);
    markReconnectSequenceApplied(appliedReconnectSeqByDialogProcessId, "", 10);

    expect(appliedReconnectSeqByDialogProcessId).toEqual({ "dp-1": 8 });
  });

  it("skips already applied reconnect envelopes by last applied sequence", async () => {
    const fixture = createActiveReplayFixture({
      appliedReconnectSeqByDialogProcessId: { "dp-1": 2 },
    });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: " dp-1 ",
      messages: [
        { event: StreamEventEnum.DELTA, data: { seq: 1, text: "old" } },
        { event: StreamEventEnum.DELTA, data: { seq: 3, text: "new" } },
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("new");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenCalledWith("dp-1", 3);
    expect(fixture.scrollBottom).toHaveBeenCalledTimes(1);
  });

  it("marks terminal reconnect batches and ignores later non-terminal replay for that dialog process", async () => {
    const terminalDialogProcessIdSet = new Set();
    const fixture = createActiveReplayFixture({ terminalDialogProcessIdSet });

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        { event: StreamEventEnum.DELTA, data: { seq: 1, text: "final" } },
        { event: StreamEventEnum.DONE, data: { seq: 2 } },
      ],
    });

    expect(terminalDialogProcessIdSet.has("dp-1")).toBe(true);
    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 2);
    expect(fixture.activeSession.value.messages[0].content).toBe("final");

    await applyReconnectMessagesToActiveSessionReplay({
      ...fixture,
      dialogProcessId: "dp-1",
      messages: [
        { event: StreamEventEnum.DELTA, data: { seq: 3, text: "ignored" } },
      ],
    });

    expect(fixture.activeSession.value.messages[0].content).toBe("final");
    expect(fixture.markReconnectSequenceApplied).toHaveBeenLastCalledWith("dp-1", 3);
  });
});
