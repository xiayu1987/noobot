import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { BackendChannelState, createInitialSessionRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("EV-02: THINKING updates logs and keeps pending true", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-t", content: "", pending: true, realtimeLogs: [] },
    ];

    await api.applyReconnectEvent(StreamEventEnum.THINKING, {
      sessionId: "s-1",
      dialogProcessId: "dp-t",
      seq: 1,
      dialogProcessIdFromLog: "dp-t",
      text: "thinking",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-t",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.realtimeLogs?.length).toBe(1);
  });

  it("EV-01: DELTA appends content and keeps pending unchanged", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-delta", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-delta",
      seq: 2,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-delta",
    );
    expect(assistant?.content).toBe("AB");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01c: replay in-flight DELTA does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-sending",
      seq: 1,
      text: "A",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01d: channel_state sending restores the global processing lock", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-cs",
      state: "sending",
      seq: 11,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01e: channel_state reconnecting restores the global processing lock", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "",
      state: "reconnecting",
      seq: 12,
    });

    expect(refs.sending.value).toBe(true);
  });

  it("EV-01f: channel_state stopping only marks the assistant and does not acquire the global lock", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stop", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stop",
      state: "stopping",
      seq: 12,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stop",
    );
    expect(refs.sending.value).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.stopping");
    expect(assistant?.pending).toBe(true);
  });

  it("EV-01g: stale terminal channel_state does not clear current local turn scope", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = true;
    refs.canStop.value = true;
    refs.runStateSnapshot.value = createInitialSessionRunState({
      state: BackendChannelState.SENDING,
      sessionId: "s-1",
      dialogProcessId: "",
      turnScopeId: "client-current",
      source: "local",
    });

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stale",
      state: "completed",
      seq: 99,
    });

    expect(refs.sending.value).toBe(false);
    expect(refs.canStop.value).toBe(false);
    expect(refs.runStateSnapshot.value.state).toBe("idle");
    expect(refs.runStateSnapshot.value).not.toHaveProperty("turnScopeId");
    expect(refs.runStateSnapshot.value).not.toHaveProperty("dialogProcessId");
  });

  it("EV-02b: replay in-flight THINKING does not restore sending without channel_state", async () => {
    const { api, refs } = createFixture();
    refs.sending.value = false;
    refs.activeSession.value.messages = [{ role: RoleEnum.USER, content: "q" }];

    await api.applyReconnectEvent(StreamEventEnum.THINKING, {
      sessionId: "s-1",
      dialogProcessId: "dp-thinking",
      seq: 1,
      text: "thinking",
    });

    expect(refs.sending.value).toBe(false);
  });

  it("EV-01b: when current turn has no user, render session first then replay", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "old-q", ts: 1 },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2, pending: false },
    ];
    refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];

    mocks.chatList.fetchSessionDetail = vi.fn(async () => ({
      sessionId: "s-1",
      sessions: [
        {
          sessionId: "s-1",
          messages: [
            { role: RoleEnum.USER, content: "old-q", ts: 1 },
            { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-old", content: "old-a", ts: 2 },
            { role: RoleEnum.USER, content: "new-q", ts: 3 },
          ],
        },
      ],
    }));
    mocks.chatList.applySessionDetail = vi.fn((detail) => {
      const main = (detail?.sessions || [])[0] || {};
      refs.activeSession.value.messages = (main.messages || []).map((message) => ({ ...message }));
      refs.activeSession.value.rawMessages = [...refs.activeSession.value.messages];
    });

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-new",
      seq: 1,
      text: "A",
    });

    const userIdx = refs.activeSession.value.messages.findIndex(
      (message) => message.role === RoleEnum.USER && message.content === "new-q",
    );
    const assistantIdx = refs.activeSession.value.messages.findIndex(
      (message) =>
        message.role === RoleEnum.ASSISTANT &&
        message.dialogProcessId === "dp-new" &&
        message.content === "A",
    );
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
  });

  it("EV-03: INTERACTION_REQUEST sets pending interaction without terminal cleanup", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int",
      seq: 1,
      requestId: "req-1",
      interactionType: "confirm",
    });

    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteraction).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(refs.interactionSubmitting.value).toBe(false);
  });

  it("EV-03b: non-interaction replay event does not clear interaction without channel_state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-int2", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 1,
      requestId: "req-2",
      interactionType: "confirm",
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2",
      seq: 2,
      text: "resume",
    });

    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("EV-03b2: auto-resolved interaction replay does not enter pending", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.INTERACTION_REQUEST, {
      sessionId: "s-1",
      dialogProcessId: "dp-int2-auto",
      seq: 1,
      requestId: "req-2-auto",
      interactionType: "post_action_notice",
      lifecycle: "resolved",
      ackMode: "auto",
    });

    expect(mocks.setPendingInteractionRequest).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteraction).toHaveBeenCalled();
  });

  it("EV-03c: channel_state completed clears obsolete interaction for same turn", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
      state: "completed",
      seq: 12,
    });

    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-int3",
    });
  });

  it("EV-03d: channel_state interaction_pending restores pending interaction payload", async () => {
    const { api, refs, mocks } = createFixture();
    refs.interactionSubmitting.value = false;

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      state: "interaction_pending",
      seq: 13,
      pendingInteraction: {
        requestId: "req-4",
        sessionId: "s-1",
        dialogProcessId: "dp-int4",
        interactionType: "confirm",
        content: "need confirm",
      },
    });

    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.setPendingInteractionRequest).toHaveBeenCalledTimes(1);
    expect(mocks.setPendingInteractionRequest.mock.calls[0][0]).toMatchObject({
      requestId: "req-4",
      sessionId: "s-1",
      dialogProcessId: "dp-int4",
      interactionType: "confirm",
      content: "need confirm",
    });
  });

  it("EV-03e: channel_state sending only clears interaction when sourceEvent=interaction_response", async () => {
    const { api, mocks } = createFixture();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      seq: 14,
    });
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();

    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-int5",
      state: "sending",
      sourceEvent: "interaction_response",
      requestId: "req-int5",
      seq: 15,
    });
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      requestId: "req-int5",
    });
  });
});
