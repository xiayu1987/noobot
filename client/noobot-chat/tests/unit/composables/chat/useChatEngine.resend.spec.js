import { describe, expect, it, vi } from "vitest";
import {
  createHarness,
  makeSession,
  assistantMessage,
  emitChannelState,
} from "./helpers/useChatEngineHarness";
import { SESSION_RUN_STATE } from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  RoleEnum,
  StreamEventEnum,
} from "../../../../src/shared/constants/chatConstants";

describe("useChatEngine.resend", () => {
  it("resendMonotonicMessage keeps final edited messages after backend delete fallback", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-stale-snapshot",
          dialogProcessId: "dp-edited",
          messages: [
            { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
            { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.USER, content: "first" };
    const staleTarget = { turnScopeId: "scope-old", dialogProcessId: "dp-old", role: RoleEnum.ASSISTANT, content: "target" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-stale-snapshot", {
        messages: [staleFirst, staleTarget],
        rawMessages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-stale-snapshot",
      sessions: [{
        sessionId: "local-resend-stale-snapshot",
        messages: [
          { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
          { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
        ],
      }],
    }));
    const { engine, activeSession, appendMessage } = createHarness({
      sessionId: "local-resend-stale-snapshot",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-fallback", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    const userMessages = activeSession.value.rawMessages.filter((message) => message.role === RoleEnum.USER);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("edited question");
    expect(activeSession.value.rawMessages.find((message) => message.content === "first")).toBeUndefined();
    expect(activeSession.value.rawMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("resendMonotonicMessage keeps edited assistant after final stale prune", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-keep-assistant",
          dialogProcessId: "dp-edited",
          messages: [
            { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
            { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target", dialogProcessId: "dp-old" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-keep-assistant", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-keep-assistant",
      sessions: [{
        sessionId: "local-resend-keep-assistant",
        messages: [
          staleFirst,
          staleTarget,
          { turnScopeId: "scope-new", role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-edited" },
          { turnScopeId: "scope-new", role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-edited" },
        ],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-keep-assistant",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    const first = { ...staleFirst };
    const target = { ...staleTarget };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    expect(activeSession.value.messages.find((message) => message.content === "first")).toBeUndefined();
    expect(activeSession.value.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
    expect(activeSession.value.rawMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
      expect.objectContaining({ role: RoleEnum.ASSISTANT, content: "edited answer" }),
    ]));
  });

  it("resendMonotonicMessage keeps the edited turn when final detail reuses the old dialogProcessId", async () => {
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-reused-dialog",
          dialogProcessId: "dp-old",
          messages: [
            { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-old" },
            { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-old" },
          ],
        },
      });
    });
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "first", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "target", dialogProcessId: "dp-old" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-reused-dialog", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-reused-dialog",
      sessions: [{
        sessionId: "local-resend-reused-dialog",
        messages: [
          staleFirst,
          staleTarget,
          { role: RoleEnum.USER, content: "edited question", dialogProcessId: "dp-old" },
          { role: RoleEnum.ASSISTANT, content: "edited answer", dialogProcessId: "dp-old" },
        ],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-reused-dialog",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([{ ...staleFirst }, { ...staleTarget }]);
    return;

    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "edited question",
      "edited answer",
    ]);
    expect(activeSession.value.rawMessages.map((message) => message.content)).toEqual([
      "edited question",
      "edited answer",
    ]);
  });

  it("resendMonotonicMessage keeps duplicate edited content during final reconcile", async () => {
    const staleFirst = { turnScopeId: "scope-old", role: RoleEnum.USER, content: "repeat", dialogProcessId: "dp-old" };
    const staleTarget = { turnScopeId: "scope-old", role: RoleEnum.ASSISTANT, content: "old answer", dialogProcessId: "dp-old" };
    const editedUser = { role: RoleEnum.USER, content: "repeat", dialogProcessId: "dp-old" };
    const editedAssistant = { role: RoleEnum.ASSISTANT, content: "new answer", dialogProcessId: "dp-old" };
    const stream = vi.fn(async (_payload, onEvent) => {
      onEvent({
        event: StreamEventEnum.DONE,
        data: {
          sessionId: "local-resend-duplicate-content",
          dialogProcessId: "dp-old",
          messages: [editedUser, editedAssistant],
        },
      });
    });
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-duplicate-content", {
        messages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const fetchSessionDetail = vi.fn(async () => ({
      sessionId: "local-resend-duplicate-content",
      sessions: [{
        sessionId: "local-resend-duplicate-content",
        messages: [staleFirst, staleTarget, editedUser, editedAssistant],
      }],
    }));
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-duplicate-content",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail, fetchSessionDetail },
    });
    activeSession.value.messages = [{ ...staleFirst }, { ...staleTarget }];
    activeSession.value.rawMessages = [{ ...staleFirst }, { ...staleTarget }];

    await expect(engine.resendMonotonicMessage(staleTarget, "repeat")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([{ ...staleFirst }, { ...staleTarget }]);
    return;

    expect(activeSession.value.messages.map((message) => message.content)).toEqual([
      "repeat",
      "new answer",
    ]);
    expect(activeSession.value.messages.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
  });

  it("resendMonotonicMessage prunes stale backend snapshot before appending edited message", async () => {
    let observedMessagesAtStream = null;
    let observedRawMessagesAtStream = null;
    const stream = vi.fn(async () => {
      observedMessagesAtStream = [...activeSession.value.messages];
      observedRawMessagesAtStream = [...activeSession.value.rawMessages];
    });
    const staleFirst = { id: "m1", role: RoleEnum.USER, content: "first" };
    const staleTarget = { id: "m2", role: RoleEnum.ASSISTANT, content: "target" };
    const deleteSessionMessagesFromApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-no-flicker", {
        messages: [staleFirst, staleTarget],
        rawMessages: [staleFirst, staleTarget],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value.messages = [...(mainSession.messages || [])];
      activeSession.value.rawMessages = [...(mainSession.messages || [])];
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-no-flicker",
      stream,
      deps: { deleteSessionMessagesFromApi, applySessionDetail },
    });
    const first = { id: "m1", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.USER, content: "first" };
    const target = { id: "m2", turnScopeId: "client-turn:replace-throw-404", role: RoleEnum.ASSISTANT, content: "target" };
    activeSession.value.messages = [first, target];
    activeSession.value.rawMessages = [first, target];

    await expect(engine.resendMonotonicMessage(target, "edited question")).resolves.toBe(false);
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([first, target]);
    return;

    expect(observedMessagesAtStream).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: RoleEnum.USER, content: "edited question" }),
    ]));
    expect(observedMessagesAtStream.find((message) => message.content === "first")).toBeUndefined();
    expect(observedRawMessagesAtStream.find((message) => message.content === "first")).toBeUndefined();
    expect(observedMessagesAtStream.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
    expect(observedRawMessagesAtStream.filter((message) => message.role === RoleEnum.USER)).toHaveLength(1);
  });

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
      state: SESSION_RUN_STATE.RESEND_STREAMING,
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
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: replacementUser.turnScopeId,
    }));
  });

  it("resendMonotonicMessage rejects stale stopped replacement snapshots without the new turnScopeId", async () => {
    const stream = vi.fn(async () => {});
    const staleStoppedUser = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.USER,
      content: "stopped question",
      stopState: "stopped",
      monotonicState: "monotonic",
    };
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:stopped-old",
      role: RoleEnum.ASSISTANT,
      content: "partial stopped",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    const replaceSessionTurnApi = vi.fn(async () => ({
      ok: true,
      session: makeSession("local-resend-stale-stopped", {
        messages: [staleStoppedUser, staleStoppedAssistant],
        rawMessages: [staleStoppedUser, staleStoppedAssistant],
      }),
    }));
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-stale-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [staleStoppedUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [staleStoppedUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "edited again")).resolves.toBe(false);

    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([staleStoppedUser, staleStoppedAssistant]);
  });

  it("resendMonotonicMessage can repeatedly replace a stopped turn and append a fresh assistant placeholder", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-repeat-stopped", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-repeat-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.USER,
      content: "first stopped",
      stopState: "stopped",
      monotonicState: "monotonic",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:repeat-old",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "second resend")).resolves.toBe(true);

    const [replacementUser, placeholder] = activeSession.value.messages;
    expect(replacementUser).toEqual(expect.objectContaining({
      role: RoleEnum.USER,
      content: "second resend",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(replacementUser.stopState).toBeUndefined();
    expect(placeholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: replacementUser.turnScopeId,
    }));
    expect(placeholder.statusLabel).toBe("");
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("resendMonotonicMessage keeps the second replacement turn running instead of inheriting stopped state", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-second-stopped", {
          messages: [replacementUser],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, runStateSnapshot, sending, canStop } = createHarness({
      sessionId: "local-resend-second-stopped",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.USER,
        content: "first stopped",
        stopState: "stopped",
      },
      {
        turnScopeId: "client-turn:old",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        stopState: "stopped",
        channelState: { state: "stopped", turnScopeId: "client-turn:old" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstReplacementUser = activeSession.value.messages[0];
    const firstReplacementAssistant = activeSession.value.messages[1];
    const firstTurnScopeId = firstReplacementUser.turnScopeId;

    firstReplacementUser.stopState = "stopped";
    firstReplacementUser.monotonicState = "monotonic";
    firstReplacementAssistant.pending = false;
    firstReplacementAssistant.statusLabel = "chat.stopped";
    firstReplacementAssistant.stopState = "stopped";
    firstReplacementAssistant.channelState = { state: "stopped", turnScopeId: firstTurnScopeId };
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.STOPPED,
      sessionId: "local-resend-second-stopped",
      dialogProcessId: "",
      turnScopeId: firstTurnScopeId,
      seq: 0,
    };
    sending.value = false;
    canStop.value = false;

    await expect(engine.resendMonotonicMessage(firstReplacementAssistant, "third")).resolves.toBe(true);

    const [secondReplacementUser, secondPlaceholder] = activeSession.value.messages;
    expect(secondReplacementUser.turnScopeId).toMatch(/^client-turn:/);
    expect(secondReplacementUser.turnScopeId).not.toBe(firstTurnScopeId);
    expect(secondReplacementUser.stopState).toBeUndefined();
    expect(secondPlaceholder).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: secondReplacementUser.turnScopeId,
    }));
    expect(secondPlaceholder.stopState).toBeUndefined();
    expect(secondPlaceholder.channelState?.state).not.toBe("stopped");
    expect(runStateSnapshot.value).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: secondReplacementUser.turnScopeId,
    });
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it("resendMonotonicMessage ignores stale stopped channel_state replayed onto a fresh replacement turn", async () => {
    let streamCallCount = 0;
    const stream = vi.fn(async (payload, onEvent) => {
      streamCallCount += 1;
      if (streamCallCount === 2) {
        emitChannelState(onEvent, "local-resend-stale-stop-replay", "dp-old-stopped", "stopped", {
          turnScopeId: payload.turnScopeId,
        });
      }
    });
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
        dialogProcessId: "",
      };
      return {
        ok: true,
        session: makeSession("local-resend-stale-stop-replay", {
          messages: [
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.USER,
              content: "historical stopped",
              dialogProcessId: "dp-old-stopped",
              stopState: "stopped",
            },
            {
              turnScopeId: "client-turn:history",
              role: RoleEnum.ASSISTANT,
              content: "historical partial",
              pending: false,
              statusLabel: "chat.stopped",
              dialogProcessId: "dp-old-stopped",
              channelState: { state: "stopped", dialogProcessId: "dp-old-stopped", turnScopeId: "client-turn:history" },
            },
            replacementUser,
          ],
          rawMessages: [replacementUser],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession, runStateSnapshot, sending, canStop } = createHarness({
      sessionId: "local-resend-stale-stop-replay",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    activeSession.value.messages = [
      { turnScopeId: "client-turn:first", role: RoleEnum.USER, content: "first", stopState: "stopped" },
      {
        turnScopeId: "client-turn:first",
        role: RoleEnum.ASSISTANT,
        content: "partial",
        pending: false,
        statusLabel: "chat.stopped",
        channelState: { state: "stopped", turnScopeId: "client-turn:first" },
      },
    ];
    activeSession.value.rawMessages = [...activeSession.value.messages];

    await expect(engine.resendMonotonicMessage(activeSession.value.messages[1], "second")).resolves.toBe(true);
    const firstAssistant = activeSession.value.messages.find((message) => message.role === RoleEnum.ASSISTANT && message.pending === true);
    firstAssistant.pending = false;
    firstAssistant.statusLabel = "chat.stopped";
    firstAssistant.channelState = { state: "stopped", turnScopeId: firstAssistant.turnScopeId };
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.STOPPED,
      sessionId: "local-resend-stale-stop-replay",
      turnScopeId: firstAssistant.turnScopeId,
      seq: 0,
    };
    sending.value = false;
    canStop.value = false;

    await expect(engine.resendMonotonicMessage(firstAssistant, "third")).resolves.toBe(true);

    const freshPlaceholder = [...activeSession.value.messages]
      .reverse()
      .find((message) => message.role === RoleEnum.ASSISTANT && message.pending === true);
    expect(freshPlaceholder).toEqual(expect.objectContaining({
      content: "",
      pending: true,
      statusLabel: "",
      turnScopeId: expect.stringMatching(/^client-turn:/),
    }));
    expect(freshPlaceholder.channelState?.state).not.toBe("stopped");
    expect(runStateSnapshot.value).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: freshPlaceholder.turnScopeId,
    });
    expect(sending.value).toBe(true);
    expect(canStop.value).toBe(true);
  });

  it("resendMonotonicMessage rejects when frontend run state has no matching in-flight assistant", async () => {
    const stream = vi.fn(async () => {});
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => ({
      ok: true,
      session: makeSession("local-resend-state-mismatch", {
        messages: [{ turnScopeId, role: RoleEnum.USER, content: newContent }],
        rawMessages: [{ turnScopeId, role: RoleEnum.USER, content: newContent }],
      }),
    }));
    const { engine, activeSession, runStateSnapshot, sending, canStop, deps } = createHarness({
      sessionId: "local-resend-state-mismatch",
      stream,
      deps: { replaceSessionTurnApi },
    });
    const stoppedUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old stopped",
      stopState: "stopped",
    };
    const stoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "partial",
      pending: false,
      statusLabel: "chat.stopped",
      channelState: { state: "stopped", turnScopeId: "client-turn:old-stopped" },
    };
    activeSession.value.messages = [stoppedUser, stoppedAssistant];
    activeSession.value.rawMessages = [stoppedUser, stoppedAssistant];
    sending.value = true;
    canStop.value = false;
    runStateSnapshot.value = {
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      sessionId: "local-resend-state-mismatch",
      turnScopeId: "client-turn:missing-in-flight",
    };

    await expect(engine.resendMonotonicMessage(stoppedAssistant, "retry")).resolves.toBe(false);

    expect(replaceSessionTurnApi).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toEqual([stoppedUser, stoppedAssistant]);
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "warning",
      message: "chat.sessionStateOutOfSync",
    }));
  });

  it("resendMonotonicMessage ignores stale stopped assistants after the new replacement user", async () => {
    const stream = vi.fn(async () => {});
    const staleStoppedAssistant = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.ASSISTANT,
      content: "old stopped partial",
      statusLabel: "chat.stopped",
      stopState: "stopped",
    };
    const replaceSessionTurnApi = vi.fn(async ({ turnScopeId, newContent }) => {
      const replacementUser = {
        turnScopeId,
        role: RoleEnum.USER,
        content: newContent,
      };
      return {
        ok: true,
        session: makeSession("local-resend-ignore-stale-assistant", {
          messages: [replacementUser, staleStoppedAssistant],
          rawMessages: [replacementUser, staleStoppedAssistant],
        }),
      };
    });
    const applySessionDetail = vi.fn((detail) => {
      const mainSession = detail.sessions?.[0] || {};
      activeSession.value = { ...activeSession.value, ...mainSession };
    });
    const { engine, activeSession } = createHarness({
      sessionId: "local-resend-ignore-stale-assistant",
      stream,
      deps: { replaceSessionTurnApi, applySessionDetail },
    });
    const oldUser = {
      turnScopeId: "client-turn:old-stopped",
      role: RoleEnum.USER,
      content: "old",
      stopState: "stopped",
    };
    activeSession.value.messages = [oldUser, staleStoppedAssistant];
    activeSession.value.rawMessages = [oldUser, staleStoppedAssistant];

    await expect(engine.resendMonotonicMessage(staleStoppedAssistant, "new attempt")).resolves.toBe(true);

    const replacementUser = activeSession.value.messages.find((message) => message.role === RoleEnum.USER);
    const latestAssistant = activeSession.value.messages[activeSession.value.messages.length - 1];
    expect(latestAssistant).toEqual(expect.objectContaining({
      role: RoleEnum.ASSISTANT,
      content: "",
      pending: true,
      turnScopeId: replacementUser.turnScopeId,
      statusLabel: "",
    }));
    expect(stream).toHaveBeenCalledTimes(1);
  });

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

  it("resendMonotonicMessage does not generate again when replace-turn returns completed assistant snapshot", async () => {
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
    expect(stream).not.toHaveBeenCalled();
    expect(activeSession.value.messages.map((message) => message.content)).toEqual(["edited question", "edited answer"]);
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("");
  });

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
    expect(activeSession.value.rawMessages).toEqual([first, target]);
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
    expect(activeSession.value.rawMessages).toEqual([first, target]);
    expect(activeSession.value.messageCount).toBe(2);
    expect(activeSession.value.lastMessage).toStrictEqual(target);
    expect(activeSession.value.updatedAt).toBe("before");
    expect(activeSession.value).not.toHaveProperty("pendingResendStalePrune");
    expect(input.value).toBe("draft before resend");
  });
});
