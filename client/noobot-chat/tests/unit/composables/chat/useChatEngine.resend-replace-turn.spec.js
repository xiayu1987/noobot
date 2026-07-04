import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  makeSession,
  assistantMessage,
  emitChannelState,
} from "./helpers/useChatEngineHarness";
import { FrontendRunState } from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.resend replace turn", () => {
  it("resendMonotonicMessage continues generation after atomic replace-turn returns user-only snapshot", async () => {
    const stream = vi.fn(async () => {});
    const deleteSessionMessagesFromApi = vi.fn();
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId }) => {
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: "edited question" };
      return {
      ok: true,
      newTurn: replacementUser,
      session: makeSession("local-resend-replace-success", {
        messages: [replacementUser],
        rawMessages: [replacementUser],
        messageCount: 1,
        version: 4,
      }),
    };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
      input.value = "";
    });
    const { engine, activeSession, input, appendMessage, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-resend-replace-success",
      stream,
      deps: { replaceSessionTurnApi, deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { turnScopeId: "client-turn:old", role: RoleEnum.USER, content: "first" };
    const target = { turnScopeId: "client-turn:old", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];
    activeSession.value.version = 3;
    input.value = "draft before replace";
  
    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(true);
  
    expect(replaceSessionTurnApi).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-resend-replace-success",
      parentSessionId: "",
      anchor: { turnScopeId: "client-turn:old" },
      newContent: "edited question",
      turnScopeId: expect.stringMatching(/^client-turn:/),
      expectedVersion: 3,
      idempotencyKey: expect.any(String),
    }), expect.any(Object));
    expect(applySessionDetail).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "local-resend-replace-success",
      sessions: [expect.objectContaining({
        messages: [expect.objectContaining({ turnScopeId: expect.stringMatching(/^client-turn:/), content: "edited question" })],
      })],
    }), { preserveCurrentMessages: true });
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0].message).toBe("edited question");
    expect(stream.mock.calls[0][0].sessionId).toBe("local-resend-replace-success");
    expect(stream.mock.calls[0][0].turnScopeId).toEqual(expect.stringMatching(/^client-turn:/));
    expect(stream.mock.calls[0][0].config).toEqual(expect.objectContaining({
      reuseExistingUserTurn: true,
    }));
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: FrontendRunState.RESEND_STREAMING,
      dialogProcessId: "",
      turnScopeId: expect.any(String),
    }));
    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(appendMessage).not.toHaveBeenCalledWith(RoleEnum.USER, "edited question", []);
    expect(appendMessage).toHaveBeenCalledWith(RoleEnum.ASSISTANT, "", []);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", ""]);
    expect(activeSession.value.messages[0].turnScopeId).toBe(activeSession.value.messages[1].turnScopeId);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("");
  });

  it("resendMonotonicMessage refreshes session version after 409 and retries replace-turn with the newer version", async () => {
    const stream = vi.fn(async () => {});
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-version-retry",
      sessions: [makeSession("local-resend-version-retry", {
        version: 5,
        revision: 5,
        messages: [
          { turnScopeId: "client-turn:old-version", role: RoleEnum.USER, content: "old" },
          { turnScopeId: "client-turn:old-version", role: RoleEnum.ASSISTANT, content: "stopped", stopState: "stopped" },
        ],
      })],
    }));
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent, expectedVersion }) => {
      if (expectedVersion === 3) {
        return { ok: false, status: 409, statusText: "Conflict", error: "session version conflict" };
      }
      const replacementUser = { turnScopeId, role: RoleEnum.USER, content: newContent };
      return {
        ok: true,
        session: makeSession("local-resend-version-retry", {
          version: 6,
          revision: 6,
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-resend-version-retry",
      stream,
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    const stoppedUser = { turnScopeId: "client-turn:old-version", role: RoleEnum.USER, content: "old" };
    const stoppedAssistant = { turnScopeId: "client-turn:old-version", role: RoleEnum.ASSISTANT, content: "partial", stopState: "stopped" };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.version = 3;
    activeSession.value.revision = 3;
  
    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited after conflict")).resolves.toBe(true);
  
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(2);
    expect(replaceSessionTurnApi.mock.calls[0][0]).toEqual(expect.objectContaining({ expectedVersion: 3 }));
    expect(replaceSessionTurnApi.mock.calls[1][0]).toEqual(expect.objectContaining({ expectedVersion: 5 }));
    expect(replaceSessionTurnApi.mock.calls[1][0].idempotencyKey).toContain("retry-version");
    expect(fetchSessionDetail).toHaveBeenCalledWith("local-resend-version-retry", expect.objectContaining({
      force: true,
      reuseRecentlyLoaded: false,
      source: "resendVersionConflict",
    }));
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toEqual(expect.objectContaining({
      message: "edited after conflict",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(appendMessage).toHaveBeenCalledWith(RoleEnum.ASSISTANT, "", []);
  });

  it("resendMonotonicMessage does not retry a 409 when refresh does not advance the session version", async () => {
    const stream = vi.fn(async () => {});
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-version-no-change",
      sessions: [makeSession("local-resend-version-no-change", {
        version: 3,
        revision: 3,
        messages: [{ turnScopeId: "client-turn:no-change", role: RoleEnum.USER, content: "old" }],
      })],
    }));
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: false,
      status: 409,
      statusText: "Conflict",
      error: "session version conflict",
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, input } = createHarness({
      sessionId: "local-resend-version-no-change",
      stream,
      deps: { replaceSessionTurnApi, fetchSessionDetail, applySessionDetail },
    });
    const stoppedUser = { turnScopeId: "client-turn:no-change", role: RoleEnum.USER, content: "old" };
    const stoppedAssistant = { turnScopeId: "client-turn:no-change", role: RoleEnum.ASSISTANT, content: "partial", stopState: "stopped" };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    activeSession.value.version = 3;
    activeSession.value.revision = 3;
    input.value = "draft before failed retry";
  
    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited no retry")).resolves.toBe(false);
  
    expect(replaceSessionTurnApi).toHaveBeenCalledTimes(1);
    expect(fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([stoppedUser, stoppedAssistant]);
    expect(input.value).toBe("draft before failed retry");
  });

  it("resendMonotonicMessage ignores stopped assistant returned with the fresh replacement turn and continues streaming", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      const staleStoppedAssistant = {
        turnScopeId,
        role: RoleEnum.ASSISTANT,
        content: "old stopped partial",
        pending: false,
        statusLabel: "chat.stopped",
        stopState: "stopped",
        channelState: { state: "stopped", turnScopeId },
      };
      return {
        ok: true,
        session: makeSession("local-resend-fresh-stopped-assistant", {
          messages: [replacementUser, staleStoppedAssistant],
          rawMessages: [replacementUser, staleStoppedAssistant],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, sending, canStop, runStateSnapshot } = createHarness({
      sessionId: "local-resend-fresh-stopped-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:first-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      stopState: "stopped",
      channelState: { state: "stopped", turnScopeId: "client-turn:first-old" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [...activeSession.value.messages];
  
    await expect(engine.resendMonotonicMessage(stoppedAssistant, "edited first resend")).resolves.toBe(true);
  
    expect(stream).toHaveBeenCalledTimes(1);
    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "edited first resend",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(placeholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: replacementUser.turnScopeId,
    }));
    expect(activeSession.value.messages).toHaveLength(2);
    expect(activeSession.value.messages.some((message) => message.stopState === "stopped")).toBe(false);
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(runStateSnapshot.value).toEqual(expect.objectContaining({
      state: FrontendRunState.RESEND_STREAMING,
      turnScopeId: replacementUser.turnScopeId,
    }));
  });
});
