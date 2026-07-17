/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  makeSession,
  assistantMessage,
  emitChannelState,
} from "./helpers/useChatEngineHarness";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.resend scoped pruning", () => {
  it("resendMonotonicMessage keeps edited content when reusing a stale user message object", async () => {
    let observedUserMessage = null;
    const stream = vi.fn(async () => {
      observedUserMessage = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const staleReplacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: "original question",
      };
      return {
      ok: true,
      newTurn: staleReplacementUser,
      session: makeSession("local-resend-replace-stale", {
        messages: [staleReplacementUser],
        rawMessages: [staleReplacementUser],
      }),
    };
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
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = {
        id: "new-user",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited question",
      };
      return {
      ok: true,
      turnScopeReplacement: {
        replacedTurnScopeIds: ["client-turn:old"],
        replacementTurnScopeId: turnScopeId,
        replacementTurnScopeIds: [turnScopeId],
      },
      session: makeSession("local-resend-replace-mapping", {
        // Simulate a stale refresh/apply race that still contains the old
        // turn. The explicit backend mapping must decide what to remove.
        messages: [oldUser, oldAssistant, replacementUser],
        rawMessages: [oldUser, oldAssistant, replacementUser],
        messageCount: 3,
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
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
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = {
        id: "u-new",
        role: RoleEnum.USER,
        content: "same question",
        turnScopeId,
      };
      return {
      ok: true,
      newTurn: replacementUser,
      session: makeSession("local-resend-duplicate-scoped-latest", {
        messages: [previousUser, previousAssistant, replacementUser],
        rawMessages: [previousUser, previousAssistant, replacementUser],
        version: 4,
      }),
    };
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
      undefined,
    ]);
    expect(observedMessagesAtStream[2]).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "same question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(observedMessagesAtStream[3]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: observedMessagesAtStream[2].turnScopeId,
    }));
  });

  it("resendMonotonicMessage still generates after replace-turn snapshot unless backend marks generation completed", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: "edited question" };
      const replacementAssistant = { turnScopeId, role: RoleEnum.ASSISTANT, content: "edited answer" };
      return {
      ok: true,
      session: makeSession("local-resend-replace-completed", {
        messages: [replacementUser, replacementAssistant],
        rawMessages: [replacementUser, replacementAssistant],
        messageCount: 2,
        version: 4,
      }),
    };
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
      message: "edited question",
      sessionId: "local-resend-replace-completed",
      config: expect.objectContaining({
        reuseExistingUserTurn: true,
      }),
    }));
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", "edited answer", ""]);
    expect(activeSession.value.messages[2]).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      pending: true,
    }));
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("");
  });
});
