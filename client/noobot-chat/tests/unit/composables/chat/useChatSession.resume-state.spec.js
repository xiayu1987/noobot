import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, toRef } from "vue";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { RoleEnum, StreamEventEnum } from "../../../../src/shared/constants/chatConstants";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
  applySessionRunStateEvent,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import {
  createChatSession,
  createSessionFixture,
  sessionLogClientMock,
  wsClientMock,
} from "./useChatSession.test-helpers.js";

function detailResponse({ sessionId, status, dialogProcessId, turnScopeId }) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      exists: true,
      sessionId,
      sessions: [{
        sessionId,
        turnStatuses: [{ status, dialogProcessId, turnScopeId }],
        messages: [
          { role: RoleEnum.USER, content: "question", turnScopeId },
          { role: RoleEnum.ASSISTANT, content: "answer", dialogProcessId, turnScopeId },
        ],
      }],
    }),
  };
}

describe("useChatSession summary and reconnect state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useChatStore().resetChatStore();
    Object.values(wsClientMock).forEach((fn) => fn?.mockReset?.());
    wsClientMock.isStopRequested.mockReturnValue(false);
    wsClientMock.reconnect.mockResolvedValue(undefined);
    sessionLogClientMock.log.mockClear();
    sessionLogClientMock.debug.mockClear();
    sessionLogClientMock.dispose.mockClear();
  });

  it("keeps dialogProcessId and turnScopeId conversation state keys separate", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-state", backendSessionId: "s-state" })];
    store.activeSessionId = "s-state";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-state", dialogProcessId: "same-id", state: "sending", seq: 1,
      } });
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-state", turnScopeId: "same-id", state: "completed", seq: 2,
      } });
    });
    const authFetch = vi.fn(async () => ({ ok: true, json: async () => ({
      ok: true, exists: true, sessionId: "s-state", sessions: [], messages: [],
    }) }));
    const session = createChatSession({ authFetch });

    await session.handleReconnect();

    expect(session.conversationStateSnapshot.value["s-state::dialogProcess:same-id"].state).toBe("sending");
    expect(session.conversationStateSnapshot.value["s-state::turnScope:same-id"].state).toBe("completed");
    expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
  });

  it("does not let a bare backend stopped reconnect acquire the global interaction lock", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-reconnect", backendSessionId: "s-reconnect" })];
    store.activeSessionId = "s-reconnect";
    wsClientMock.reconnect.mockImplementationOnce(async ({ onReconnectData }) => {
      onReconnectData({ event: StreamEventEnum.CHANNEL_STATE, data: {
        sessionId: "s-reconnect", dialogProcessId: "dp-stop", turnScopeId: "turn-stop", state: "user_stopped",
      } });
    });
    const session = createChatSession();

    await session.handleReconnect();

    expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
    expect(session.sending.value).toBe(false);
    expect(session.composerActionState.value.canDeleteMessage).toBe(true);
    expect(store.runStateSnapshot).not.toHaveProperty("dialogProcessId");
    expect(store.runStateSnapshot).not.toHaveProperty("turnScopeId");
  });

  it("keeps a local stop mutex until the authoritative summary is applied", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-stop", backendSessionId: "s-stop", loaded: false })];
    store.activeSessionId = "s-stop";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"), sending: toRef(store, "sending"), canStop: toRef(store, "canStop"),
      event: { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED, source: "test" },
    });
    expect(store.runStateSnapshot.state).toBe(FrontendRunState.USER_STOPPING);
    const authFetch = vi.fn(async () => detailResponse({
      sessionId: "s-stop", status: "user_stopped", dialogProcessId: "dp-stop", turnScopeId: "turn-stop",
    }));
    const session = createChatSession({ authFetch });

    await session.selectSession("s-stop", { force: true });
    await nextTick();

    expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
    expect(store.activeSession.turnStatuses).toEqual([
      expect.objectContaining({ status: "user_stopped", dialogProcessId: "dp-stop", turnScopeId: "turn-stop" }),
    ]);
    expect(session.composerActionState.value).toMatchObject({ primaryAction: "continue", userStopped: true });
  });

  it("restores the continue action from session summary after refresh without a resume cache", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-refresh", backendSessionId: "s-refresh", loaded: false })];
    store.activeSessionId = "s-refresh";
    const session = createChatSession({ authFetch: vi.fn(async () => detailResponse({
      sessionId: "s-refresh", status: "user_stopped", dialogProcessId: "dp-refresh", turnScopeId: "turn-refresh",
    })) });

    await session.selectSession("s-refresh", { force: true });
    await nextTick();

    expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
    expect(session.composerActionState.value.primaryAction).toBe("continue");
    expect(session.composerActionState.value.canContinue).toBe(true);
  });

  it.each(["completed", "error", "expired"])(
    "uses normal send when the authoritative summary status is %s",
    async (status) => {
      const store = useChatStore();
      const sessionId = `s-${status}`;
      store.sessions = [createSessionFixture({ id: sessionId, backendSessionId: sessionId, loaded: false })];
      store.activeSessionId = sessionId;
      const session = createChatSession({ authFetch: vi.fn(async () => detailResponse({
        sessionId, status, dialogProcessId: `dp-${status}`, turnScopeId: `turn-${status}`,
      })) });

      await session.selectSession(sessionId, { force: true });
      await nextTick();

      expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
      expect(session.composerActionState.value).toMatchObject({ primaryAction: "send", userStopped: false });
    },
  );

  it("clears the global mutex on completion-summary failure without inventing a turn result", async () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({ id: "s-fail", backendSessionId: "s-fail", loaded: false, turnStatuses: [] })];
    store.activeSessionId = "s-fail";
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"), sending: toRef(store, "sending"), canStop: toRef(store, "canStop"),
      event: { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED, source: "test" },
    });
    applySessionRunStateEvent({
      stateRef: toRef(store, "runStateSnapshot"), sending: toRef(store, "sending"), canStop: toRef(store, "canStop"),
      event: { type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED, source: "summary_request" },
    });

    expect(store.runStateSnapshot.state).toBe(FrontendRunState.IDLE);
    expect(store.activeSession.turnStatuses || []).toEqual([]);
  });

  it("a newer completed message prevents an older stopped turn from becoming the primary action", () => {
    const store = useChatStore();
    store.sessions = [createSessionFixture({
      id: "s-newer", backendSessionId: "s-newer",
      messages: [
        { role: RoleEnum.ASSISTANT, content: "old", dialogProcessId: "dp-old", turnScopeId: "turn-old" },
        { role: RoleEnum.ASSISTANT, content: "new", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      ],
      turnStatuses: [
        { status: "user_stopped", dialogProcessId: "dp-old", turnScopeId: "turn-old" },
        { status: "completed", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      ],
    })];
    store.activeSessionId = "s-newer";
    const session = createChatSession();
    expect(session.composerActionState.value.primaryAction).toBe("send");
  });
});
