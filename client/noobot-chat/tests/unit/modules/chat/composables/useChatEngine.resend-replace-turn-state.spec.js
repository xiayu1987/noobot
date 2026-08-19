/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  emitAuthorityProcessing,
  makeTurnReplacementResponse,
} from "../helpers/useChatEngineHarness.js";
import {
  BackendChannelState,
  FrontendRunState,
} from "../../../../../src/modules/chat/runtime/sessionRunStateMachine.js";
import { RoleEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

describe("useChatEngine.resend replacement turn state", () => {
  it("ignores a stopped assistant returned with the fresh replacement turn", async () => {
    const stream = vi.fn(async (payload, onEvent) => {
      emitAuthorityProcessing(onEvent, payload);
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, commandId, anchor }) => {
      const replacementUser = {
        id: "msg-user-fresh-stopped-assistant",
        messageId: "msg-user-fresh-stopped-assistant",
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-fresh-stopped-assistant",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, sending, canStop, activeTurnRuntime } = createHarness({
      sessionId: "local-resend-fresh-stopped-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "user_stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      stopState: "user_stopped",
      channelState: { state: "user_stopped", turnScopeId: "client-turn:first-old" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(
      engine.resendMonotonicMessage(stoppedAssistant, "edited first resend"),
    ).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(1);
    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(
      expect.objectContaining({
        role: RoleEnum.USER,
        content: "edited first resend",
        turnScopeId: expect.stringMatching(/^client-turn:/),
      }),
    );
    expect(placeholder).toEqual(
      expect.objectContaining({
        role: RoleEnum.ASSISTANT,
        content: "",
        pending: false,
        statusLabel: "",
        turnScopeId: replacementUser.turnScopeId,
      }),
    );
    expect(activeSession.value.messages).toHaveLength(2);
    expect(
      activeSession.value.messages.some((message) => message.stopState === "user_stopped"),
    ).toBe(false);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(activeTurnRuntime.value.state).toBe(FrontendRunState.PROCESSING);
    expect(activeTurnRuntime.value.backendState).toBe(BackendChannelState.SENDING);
    expect(activeTurnRuntime.value.turnScopeId).toBeTruthy();
  });
});
