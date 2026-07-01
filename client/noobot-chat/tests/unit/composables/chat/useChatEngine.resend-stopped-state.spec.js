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

describe("useChatEngine.resend stopped state", () => {
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
});
