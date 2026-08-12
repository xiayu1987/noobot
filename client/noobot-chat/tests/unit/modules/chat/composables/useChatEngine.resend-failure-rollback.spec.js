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
import { RoleEnum, StreamEventEnum } from "../../../../../src/modules/chat/model/chatConstants.js";

describe("useChatEngine.resend failure rollback", () => {
  it("resendMonotonicMessage fails without delete/send fallback when replace-turn is unsupported", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () => ({ ok: false, status: 404 }));
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-replace-fallback", { messages: [], rawMessages: [] }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [
        ...(mainSession.rawMessages || mainSession.messages || []),
      ];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-fallback",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      id: "m1",
      turnScopeId: "client-turn:replace-fallback",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      id: "m2",
      turnScopeId: "client-turn:replace-fallback",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited through fallback")).resolves.toBe(
      false,
    );

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
  });

  it("resendMonotonicMessage fails without fallback when replace-turn throws an HTTP 404 error", async () => {
    const stream = vi.fn(async () => {});
    const notFoundError = new Error(
      "Cannot POST /api/internal/session/u1/s1/messages/replace-turn",
    );
    notFoundError.response = { status: 404 };
    const replaceSessionTurnApi = vi.fn(async () => {
      throw notFoundError;
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-replace-throw-404", { messages: [], rawMessages: [] }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [
        ...(mainSession.rawMessages || mainSession.messages || []),
      ];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-throw-404",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = {
      id: "m1",
      turnScopeId: "client-turn:replace-throw-404",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      id: "m2",
      turnScopeId: "client-turn:replace-throw-404",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited after route 404")).resolves.toBe(
      false,
    );

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("resendMonotonicMessage rolls back and does not fallback when replace-turn fails with conflict", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async () => ({ ok: false, status: 409 }));
    const deleteSessionMessagesFromApi = vi.fn();
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-replace-conflict",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi },
    });
    const first = {
      id: "m1",
      turnScopeId: "client-turn:conflict",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      id: "m2",
      turnScopeId: "client-turn:conflict",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    input.value = "draft before conflict";

    await expect(engine.resendMonotonicMessage(target, "edited conflict")).resolves.toBe(false);

    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(input.value).toBe("draft before conflict");
  });

  it("resendMonotonicMessage rejects a replacement committed for another command", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, anchor }) => {
      const replacementUser = {
        messageId: "replacement-user-wrong-command",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited",
      };
      return makeTurnReplacementResponse({
        commandId: "another-resend-command",
        sessionId: "local-resend-command-mismatch",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-command-mismatch",
      stream,
      deps: { replaceSessionTurnApi },
    });
    const oldUser = { turnScopeId: "turn-old", role: RoleEnum.USER, content: "old" };
    const oldAssistant = { turnScopeId: "turn-old", role: RoleEnum.ASSISTANT, content: "answer" };
    activeSession.value.messages = [oldUser, oldAssistant];
    activeSession.value.rawMessages = [oldUser, oldAssistant];

    await expect(engine.resendMonotonicMessage(oldAssistant, "edited")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([oldUser, oldAssistant]);
  });

  it("resendMonotonicMessage rejects a committed snapshot that still materializes the replaced scope", async () => {
    const staleFirst = {
      turnScopeId: "scope-old",
      dialogId: "dp-reused",
      role: RoleEnum.USER,
      content: "repeat",
    };
    const staleTarget = {
      turnScopeId: "scope-old",
      dialogId: "dp-reused",
      role: RoleEnum.ASSISTANT,
      content: "old answer",
    };
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, commandId, anchor }) => {
      const replacementUser = {
        messageId: "replacement-user",
        turnScopeId,
        role: RoleEnum.USER,
        content: "repeat",
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-replace-reused-dialog",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
        messages: [staleFirst, staleTarget, replacementUser],
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [
        ...(mainSession.rawMessages || mainSession.messages || []),
      ];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-reused-dialog",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "repeat")).resolves.toBe(false);

    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "repeat",
      "old answer",
    ]);
    expect(
      activeSession.value.messages.filter((message) => message.role === RoleEnum.USER),
    ).toHaveLength(1);
  });

  it("resendMonotonicMessage keeps the committed replacement when generation fails", async () => {
    const stream = vi.fn(async () => {
      throw new Error("network failed");
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, commandId, anchor }) => {
      const replacementUser = {
        id: "m-new",
        messageId: "m-new",
        turnScopeId,
        role: RoleEnum.USER,
        content: "edited retry text",
      };
      return makeTurnReplacementResponse({
        commandId,
        sessionId: "local-resend-send-fail",
        aggregateVersion: 1,
        replacedTurnScopeIds: [anchor.turnScopeId],
        replacementUser,
      });
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-send-fail",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const first = {
      id: "m1",
      turnScopeId: "turn-send-fail",
      role: RoleEnum.USER,
      content: "first",
    };
    const target = {
      id: "m2",
      turnScopeId: "turn-send-fail",
      role: RoleEnum.ASSISTANT,
      content: "target",
    };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    activeSession.value.updatedAt = "before";
    input.value = "draft before resend";

    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);

    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages[0]).toEqual(
      expect.objectContaining({
        messageId: "m-new",
        role: RoleEnum.USER,
        content: "edited retry text",
      }),
    );
    expect(
      activeSession.value.messages.some((message) => message === first || message === target),
    ).toBe(false);
    expect(activeSession.value.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: RoleEnum.ASSISTANT,
        error: expect.any(String),
        pending: false,
      }),
    );
    expect(input.value).toBe("edited retry text");
  });
});
