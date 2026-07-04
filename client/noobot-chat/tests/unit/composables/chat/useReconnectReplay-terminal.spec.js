import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixture, createFakeProcessStore } from "./helpers/useReconnectReplayHelper";
import { SESSION_RUN_STATE } from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";

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

  it("EV-04a: DONE without channel_state patches overlay but stays awaiting frontend completion", async () => {
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
    expect(refs.sending.value).toBe(true);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-done-only",
    });
  });

  it("EV-04: channel_state completed stays backend-completed until frontend completion", async () => {
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
    expect(refs.sending.value).toBe(true);
    expect(refs.interactionSubmitting.value).toBe(false);
    expect(mocks.clearPendingInteractionIfObsolete).toHaveBeenCalledWith({
      sessionId: "s-1",
      dialogProcessId: "dp-done",
    });
  });

  it("EV-05: channel_state stopped sets stopped status", async () => {
    const { api, refs, mocks } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stopped", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      state: "stopped",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stopped",
    );
    expect(assistant?.pending).toBe(false);
    expect(assistant?.statusLabel).toBe("chat.stopped");
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
