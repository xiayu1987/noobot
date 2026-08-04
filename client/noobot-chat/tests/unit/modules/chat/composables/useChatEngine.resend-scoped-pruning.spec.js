/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  makeSession,
  makeTurnReplacementResponse,
  assistantMessage,
  emitChannelState,
} from "../helpers/useChatEngineHarness.js";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../../src/modules/chat/model/chatConstants.js";
import { isTurnRuntimeDeleted } from "../../../../../src/modules/chat/runtime/run-state-machine/turnRuntimeRegistry.js";

describe("useChatEngine.resend scoped pruning", () => {
  it("resendMonotonicMessage keeps edited content when reusing a stale user message object", async () => {
    let observedUserMessage = null;
    const stream = vi.fn(async () => {
      observedUserMessage = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, idempotencyKey, anchor }) => {
      const staleReplacementUser = {
        id: "msg-user-replace-stale",
        messageId: "msg-user-replace-stale",
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-replace-stale",
        version: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser: staleReplacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-stale",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:old-stale", role: RoleEnum.USER, content: "original question" };
    const target = { turnScopeId: "client-turn:old-stale", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(observedUserMessage).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited question",
    }));
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", ""]);
  });

  it("resendMonotonicMessage uses backend replace-turn mapping to prune stale replaced messages", async () => {
    let observedMessagesAtStream = [];
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
    });
    const deleteSessionMessagesFromApi = vi.fn();
    const oldUser = {
      id: "old-user",
      turnScopeId: "client-turn:old",
      role: RoleEnum.USER,
      content: "old question",
    };
    const oldAssistant = {
      id: "old-assistant",
      turnScopeId: "client-turn:old",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, idempotencyKey, anchor }) => {
      const replacementUser = {
        id: "new-user",
        messageId: "new-user",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited question",
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-replace-mapping",
        version: 4,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        session: { messageCount: 1 },
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, turnRuntimeRegistry } = createHarness({
      sessionId: "local-resend-replace-mapping",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    activeSession.value.messages = [oldUser, oldAssistant];
    activeSession.value.rawMessages = [oldUser, oldAssistant];
    activeSession.value.version = 3;

    await expect(engine.resendMonotonicMessage(oldAssistant, "edited question")).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(observedMessagesAtStream.find((message) => message.id === "old-user")).toBeUndefined();
    expect(observedMessagesAtStream.find((message) => message.id === "old-assistant")).toBeUndefined();
    expect(observedMessagesAtStream).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question", turnScopeId: expect.stringMatching(/^client-turn:/) }),
    ]));
    expect(activeSession.value.messages.find((message) => message.id === "new-user")).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(activeSession.value.messages.find((message) => (
      message.role === RoleEnum.USER &&
      message.content === "edited question" &&
      /^client-turn:/.test(message.turnScopeId)
    ))).toBeTruthy();
    expect(isTurnRuntimeDeleted(turnRuntimeRegistry.value, {
      sessionId: "local-resend-replace-mapping",
      turnScopeId: "client-turn:old",
    })).toBe(true);
  });

  it("resendMonotonicMessage keeps previous duplicate-content turn when resending latest scoped user", async () => {
    let observedMessagesAtStream = null;
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
    });
    const deleteSessionMessagesFromApi = vi.fn();
    const previousUser = {
      id: "u-old",
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: "client-turn:old",
    };
    const previousAssistant = {
      id: "a-old",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
      turnScopeId: "client-turn:old",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, idempotencyKey, anchor }) => {
      const replacementUser = {
        id: "u-new",
        messageId: "u-new",
        role: RoleEnum.USER,
        content: "same question",
        turnScopeId,
      };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-duplicate-scoped-latest",
        version: 4,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        messages: [previousUser, previousAssistant, replacementUser],
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-duplicate-scoped-latest",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const latestUser = {
      id: "u-latest",
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: "client-turn:latest",
    };
    activeSession.value.messages = [previousUser, previousAssistant, latestUser];
    activeSession.value.rawMessages = [previousUser, previousAssistant, latestUser];
    activeSession.value.version = 3;

    await expect(engine.resendMonotonicMessage(latestUser, "same question")).resolves.toBe(true);

    expect(replaceSessionTurnApi).toHaveBeenCalledWith(expect.objectContaining({
      anchor: { turnScopeId: "client-turn:latest" },
    }), expect.any(Object));
    expect(observedMessagesAtStream.map((message) => message.id)).toEqual([
      "u-old",
      "a-old",
      "u-new",
      expect.stringMatching(/^msg_/),
    ]);
    expect(observedMessagesAtStream[2]).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(observedMessagesAtStream[3]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: false,
      turnScopeId: observedMessagesAtStream[2].turnScopeId,
    }));
  });

  it("resendMonotonicMessage starts generation from the user-only replace-turn snapshot", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, idempotencyKey, anchor }) => {
      const replacementUser = { id: "msg-user-replace-completed", messageId: "msg-user-replace-completed", turnScopeId, role: RoleEnum.USER, content: "edited question" };
      return makeTurnReplacementResponse({
        commandId: idempotencyKey,
        sessionId: "local-resend-replace-completed",
        version: 4,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-replace-completed",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    input.value = "draft before replace";

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      commandType: "turn.resend",
      input: expect.objectContaining({ message: "edited question" }),
      identity: expect.objectContaining({ sessionId: "local-resend-replace-completed" }),
    }));
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", ""]);
    expect(activeSession.value.messages[1]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      pending: false,
    }));
    expect(input.value).toBe("");
  });
});
