import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "../../../../src/composables/chat/sessionRunStateMachine";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("EV-06/FN-01: channel_state error finalizes terminal state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-e", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.ERROR, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      seq: 2,
      error: "boom",
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      state: "error",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-e",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.failed");
    expect(assistant?.error).toBe("boom");
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-e",
    });
    expect(mocks.chatWebSocketClient.clearStopRequested).toHaveBeenCalledTimes(1);
  });

  it("EV-04a: DONE without channel_state patches overlay clears replay sending state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done-only", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done-only",
      seq: 2,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-done-only",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1");
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalled();
    expect(refs.runStateSnapshot.value).toMatchObject({
      state: FrontendRunState.IDLE,
      lastEventType: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
    });
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-done-only",
    });
  });

  it("EV-04: channel_state completed clears replay sending state", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      state: "completed",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-done",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.generated");
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1");
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalled();
    expect(refs.runStateSnapshot.value).toMatchObject({
      state: FrontendRunState.IDLE,
      lastEventType: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
    });
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-done",
    });
  });

  it.each([
    ["detail client unavailable", "unavailable"],
    ["detail request failure", "rejected"],
    ["empty detail", "empty"],
    ["mismatched detail identity", "mismatch"],
  ])("EV-04b: %s releases the global lock after summary failure", async (_label, mode) => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-detail-failure",
        turnScopeId: "turn-detail-failure",
        content: "A",
        pending: true,
      },
    ];
    if (mode === "unavailable") {
      mocks.chatList.fetchSessionDetail = undefined;
    } else if (mode === "rejected") {
      mocks.chatList.fetchSessionDetail.mockRejectedValueOnce(new Error("detail unavailable"));
    } else if (mode === "empty") {
      mocks.chatList.fetchSessionDetail.mockResolvedValueOnce({ sessions: [] });
    } else {
      mocks.chatList.fetchSessionDetail.mockResolvedValueOnce({
        sessionId: "s-other",
        sessions: [{ id: "s-other", sessionId: "s-other" }],
      });
    }

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-detail-failure",
      turnScopeId: "turn-detail-failure",
      seq: 2,
    });

    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
    expect(refs.runStateSnapshot.value).toMatchObject({
      state: FrontendRunState.IDLE,
      lastEventType: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    });
    expect(refs.sending.value).toBe(false);
    expect(refs.canStop.value).toBe(false);
  });

  it("EV-05: channel_state stopped sets stopped status", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stopped", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.USER_STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      state: "user_stopped",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stopped",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.stopped");
    // Replayed backend facts update the message projection, but never own the
    // global interaction lock. Persisted turn status comes from session detail.
    expect(refs.sending.value).toBe(false);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
    });
  });

  it("RC-04: terminal event blocks subsequent DELTA mutation", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-terminal", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 1,
      text: "A",
    });
    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.DELTA, {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 3,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-terminal",
    );
    expect(assistant?.content).toBe("A");
  });
});
