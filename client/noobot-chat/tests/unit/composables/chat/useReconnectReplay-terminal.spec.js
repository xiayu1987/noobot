/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
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
  it("EV-06/FN-01: channel_state error only requests authoritative terminal resolution", async () => {
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
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledWith("s-1", "turn-e", { commandId: "", sequence: 3, source: "reconnect_replay" });
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(mocks.chatWebSocketClient.clearStopRequested).not.toHaveBeenCalled();
  });

  it("EV-04a: DONE without channel_state reconciles final detail and requests authoritative terminal resolution", async () => {
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
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledWith("s-1", "turn-done-only", { commandId: "", sequence: 2, source: "reconnect_replay" });
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledWith("s-1", expect.objectContaining({
      source: "reconnectDoneFinalStatus",
      force: true,
      requireFresh: true,
    }));
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
  });

  it("EV-04: channel_state completed remains notification-only", async () => {
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
    // DONE and channel_state=completed are both terminal notifications; each
    // independently schedules the authoritative read for the same Turn.
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledTimes(2);
    expect(mocks.resolveTurnTerminalState).toHaveBeenLastCalledWith("s-1", "turn-done", { commandId: "", sequence: 3, source: "reconnect_replay" });
    // DONE owns presentation reconciliation. The following channel_state is
    // still notification-only and must not start a second detail request.
    expect(mocks.chatList.fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(mocks.chatList.applySessionDetail).toHaveBeenCalledTimes(1);
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

  it("EV-05: channel_state stopped only requests authoritative terminal resolution", async () => {
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
    // USER_STOPPED is transport replay data, not a terminal notification; only
    // the terminal channel-state triggers the single authoritative read.
    expect(mocks.resolveTurnTerminalState).toHaveBeenCalledTimes(1);
    expect(mocks.resolveTurnTerminalState).toHaveBeenLastCalledWith("s-1", "turn-stopped", { commandId: "", sequence: 3, source: "reconnect_replay" });
    expect(mocks.clearPendingInteractionIfObsolete).not.toHaveBeenCalled();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
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
