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

describe("useChatEngine.resend final reconcile", () => {
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
});
