import { effectScope } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("FN-02: cacheExpired timer refreshes sessions and clears replayCache", async () => {
    vi.useFakeTimers();
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-2",
      dialogProcessId: "dp-cache",
      seq: 1,
      text: "X",
    });
    expect(api.__test.replayCache["s-2"]).toBeTruthy();

    await api.applyReconnectData({ sessions: [], cacheExpired: true });
    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(mocks.chatList.fetchSessions).toHaveBeenCalledWith("s-1", {
      silent: true,
      preserveCurrentMessages: true,
    });
    expect(api.__test.replayCache["s-2"]).toBeUndefined();
  });

  it("FN-02b: channel_state expired triggers silent refresh timer", async () => {
    vi.useFakeTimers();
    const { api, mocks } = createFixture();
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-exp",
      state: "expired",
      seq: 15,
    });

    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(mocks.chatList.fetchSessions).toHaveBeenCalledWith("s-1", {
      silent: true,
      preserveCurrentMessages: true,
    });
  });

  it("FN-02c: channel_state no_conversation clears pending interaction", async () => {
    const { api, refs, mocks } = createFixture();
    refs.sending.value = true;
    refs.interactionSubmitting.value = true;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-none",
      state: "no_conversation",
      seq: 16,
    });

    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("FN-03: timer is cleaned on scope dispose", async () => {
    vi.useFakeTimers();
    let api;
    let chatList;
    const scope = effectScope();
    scope.run(() => {
      const fixture = createFixture();
      api = fixture.api;
      chatList = fixture.mocks.chatList;
    });

    await api.applyReconnectData({ sessions: [], cacheExpired: true });
    scope.stop();
    vi.advanceTimersByTime(1200);
    await Promise.resolve();

    expect(chatList.fetchSessions).not.toHaveBeenCalled();
  });

  it.each([
    StreamEventEnum.DONE,
    StreamEventEnum.USER_STOPPED,
    StreamEventEnum.ERROR,
  ])("FN-01: %s duplicate replay does not trigger terminal cleanup without channel_state", async (terminalEvent) => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-once", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });
    await api.applyReconnectEvent(terminalEvent, {
      sessionId: "s-1",
      dialogProcessId: "dp-once",
      seq: 2,
      ...(terminalEvent === StreamEventEnum.ERROR ? { error: "boom" } : {}),
    });

    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.chatWebSocketClient.clearStopRequested).not.toHaveBeenCalled();
  });
});
