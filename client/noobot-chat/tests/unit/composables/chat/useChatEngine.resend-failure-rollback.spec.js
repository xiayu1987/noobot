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
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-fallback",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
  
    await expect(engine.resendMonotonicMessage(target, "edited through fallback")).resolves.toBe(false);
  
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage fails without fallback when replace-turn throws an HTTP 404 error", async () => {
    const stream = vi.fn(async () => {});
    const notFoundError = new Error("Cannot POST /api/internal/session/u1/s1/messages/replace-turn");
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
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-replace-throw-404",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
  
    await expect(engine.resendMonotonicMessage(target, "edited after route 404")).resolves.toBe(false);
  
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
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
    const first = { id: "m1", turnScopeId: "client-turn:conflict", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:conflict", role: RoleEnum.ASSISTANT, content: "target" };
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
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("draft before conflict");
  });

  it("resendMonotonicMessage rejects reused dialogId snapshots without the new turnScopeId", async () => {
    const staleFirst = { turnScopeId: "scope-old", dialogId: "dp-reused", role: RoleEnum.USER, content: "repeat" };
    const staleTarget = { turnScopeId: "scope-old", dialogId: "dp-reused", role: RoleEnum.ASSISTANT, content: "old answer" };
    const editedUser = { turnScopeId: "scope-new", dialogId: "dp-reused", role: RoleEnum.USER, content: "repeat" };
    const editedAssistant = { turnScopeId: "scope-new", dialogId: "dp-reused", role: RoleEnum.ASSISTANT, content: "new answer" };
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: true,
      turnScopeReplacement: {
        replacedTurnScopeIds: ["scope-old"],
        replacementTurnScopeId: "scope-new",
        replacementTurnScopeIds: ["scope-new"],
      },
      session: makeSession("local-resend-replace-reused-dialog", {
        messages: [staleFirst, staleTarget, editedUser, editedAssistant],
        rawMessages: [staleFirst, staleTarget, editedUser, editedAssistant],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.rawMessages || mainSession.messages || [])];
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
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["repeat", "old answer"]);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage rolls back cascade deletion when send fails", async () => {
    const stream = vi.fn(async () => {
      throw new Error("network failed");
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { id: "m-new", turnScopeId, role: RoleEnum.USER, content: "edited retry text" };
      return {
        ok: true,
        session: makeSession("local-resend-send-fail", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
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
    const first = { id: "m1", turnScopeId: "turn-send-fail", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "turn-send-fail", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.messageCount = 2;
    activeSession.value.lastMessage = target;
    activeSession.value.updatedAt = "before";
    input.value = "draft before resend";
  
    await expect(engine.resendMonotonicMessage(target, "edited retry text")).resolves.toBe(false);
  
    expect(stream).toHaveBeenCalledTimes(1);
    expect(activeSession.value.messages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(activeSession.value.updatedAt).toBe("before");
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("draft before resend");
  });
});
