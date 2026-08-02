/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCanonicalAssistant,
  createFixture,
  createFakeProcessStore,
} from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("EV-06/FN-01: channel_state error is transport-only", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-e" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-e", turnScopeId: "turn-e", content: "", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.ERROR, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      turnScopeId: "turn-e",
      seq: 2,
      error: "boom",
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-e",
      turnScopeId: "turn-e",
      state: "error",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-e",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.statusLabel).toBeUndefined();
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
  });

  it("EV-04a: data-plane DONE does not reconcile or terminate a Turn", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-done-only" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done-only", turnScopeId: "turn-done-only", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done-only",
      turnScopeId: "turn-done-only",
      seq: 2,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-done-only",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.statusLabel).toBeUndefined();
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
  });

  it("EV-04: channel_state completed remains transport-only", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-done" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-done", turnScopeId: "turn-done", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.DONE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      turnScopeId: "turn-done",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-done",
      turnScopeId: "turn-done",
      state: "completed",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-done",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.statusLabel).toBeUndefined();
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
  });

  it.each([
    ["detail client unavailable", "unavailable"],
    ["detail request failure", "rejected"],
    ["empty detail", "empty"],
    ["mismatched detail identity", "mismatch"],
  ])("EV-04b: %s releases the global lock after summary failure", async (_label, mode) => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-stopped" } });
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
    expect(refs.sending.value).toBe(false);
    expect(refs.canStop.value).toBe(false);
    expect(refs.sending.value).toBe(false);
    expect(refs.canStop.value).toBe(false);
  });

  it("EV-05: channel_state stopped does not terminate or clean up a Turn", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-stopped" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      { role: RoleEnum.ASSISTANT, dialogProcessId: "dp-stopped", turnScopeId: "turn-stopped", content: "A", pending: true },
    ];

    await api.applyReconnectEvent(StreamEventEnum.USER_STOPPED, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
      seq: 2,
    });
    await api.applyReconnectEvent(StreamEventEnum.CHANNEL_STATE, {
      sessionId: "s-1",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
      state: "user_stopped",
      seq: 3,
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-stopped",
    );
    expect(assistant?.pending).toBe(true);
    expect(assistant?.statusLabel).toBeUndefined();
    expect(mocks.resolveTurnTerminalState).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
  });

  it("RC-04: transport terminal does not override later canonical message events", async () => {
    const { api, refs } = createFixture();
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      createCanonicalAssistant({ dialogProcessId: "dp-terminal" }),
    ];

    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 1,
      text: "A",
    });
    await api.applyCanonicalMessageEvent("main_model_content", {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 2,
      text: "A",
      output: "A",
    });
    await api.applyCanonicalMessageEvent("llm_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 3,
      text: "B",
    });

    const assistant = refs.activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.dialogProcessId === "dp-terminal",
    );
    expect(assistant?.content).toBe("AB");
  });
});
