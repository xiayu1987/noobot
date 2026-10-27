/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanonicalAssistant, createFixture } from "../helpers/useReconnectReplayHelper.js";
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useReconnectReplay", () => {
  it("EV-06/FN-01: channel_state error is transport-only", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-e" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-e",
        turnScopeId: "turn-e",
        content: "",
        pending: true,
      },
    ];

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
    expect(assistant?.terminalOutcome).toBeUndefined();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
  });

  it("EV-04: channel_state completed remains transport-only", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-done" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-done",
        turnScopeId: "turn-done",
        content: "A",
        pending: true,
      },
    ];

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
    expect(assistant?.terminalOutcome).toBeUndefined();
    expect(mocks.chatList.fetchSessionDetail).not.toHaveBeenCalled();
    expect(mocks.chatList.applySessionDetail).not.toHaveBeenCalled();
  });

  it("EV-05: channel_state stopped does not terminate or clean up a Turn", async () => {
    const { api, refs, mocks } = createFixture({ currentRun: { turnScopeId: "turn-stopped" } });
    refs.activeSession.value.messages = [
      { role: RoleEnum.USER, content: "q" },
      {
        role: RoleEnum.ASSISTANT,
        dialogProcessId: "dp-stopped",
        turnScopeId: "turn-stopped",
        content: "A",
        pending: true,
      },
    ];

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
    expect(assistant?.terminalOutcome).toBeUndefined();
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
    await api.applyCanonicalMessageEvent("model_analysis_delta", {
      sessionId: "s-1",
      dialogProcessId: "dp-terminal",
      seq: 2,
      text: "A",
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
