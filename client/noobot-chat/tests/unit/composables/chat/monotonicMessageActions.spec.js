import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createMonotonicMessageActions } from "../../../../src/composables/chat/chatEngine/monotonicMessageActions";
import {
  SESSION_RUN_EVENT,
  applySessionRunStateEvent,
  createInitialSessionRunState,
} from "../../../../src/composables/chat/sessionRunStateMachine";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

function createActions({
  runStateSnapshot = ref(createInitialSessionRunState()),
  applyRunStateEvent = vi.fn(),
} = {}) {
  const userMessage = {
    id: "u1",
    role: RoleEnum.USER,
    content: "hello",
    turnScopeId: "turn-1",
    ts: "2026-07-02T00:00:00.000Z",
  };
  const assistantMessage = {
    id: "a1",
    role: RoleEnum.ASSISTANT,
    content: "world",
    turnScopeId: "turn-1",
    ts: "2026-07-02T00:00:01.000Z",
  };
  const activeSession = ref({
    id: "s1",
    sessionId: "s1",
    backendSessionId: "s1",
    parentSessionId: "",
    messages: [userMessage, assistantMessage],
    rawMessages: [userMessage, assistantMessage],
    version: 1,
    revision: 1,
  });
  const deleteSessionMessagesFromApi = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, session: activeSession.value }),
  }));
  const applySessionDetail = vi.fn((detail = {}) => {
    const nextSession = Array.isArray(detail?.sessions) ? detail.sessions[0] : detail?.session;
    if (nextSession) activeSession.value = { ...activeSession.value, ...nextSession };
  });
  const fetchSessionDetail = vi.fn(async () => ({
    sessionId: "s1",
    sessions: [{ ...activeSession.value, version: 2, revision: 2 }],
  }));
  const actions = createMonotonicMessageActions({
    activeSession,
    activeSessionId: ref("s1"),
    authFetch: vi.fn(),
    clearPendingInteraction: vi.fn(),
    deleteSessionMessagesFromApi,
    replaceSessionTurnApi: vi.fn(),
    input: ref(""),
    notify: vi.fn(),
    send: vi.fn(),
    sending: ref(false),
    canStop: ref(false),
    stopSending: vi.fn(),
    translate: (key) => key,
    userId: ref("user-1"),
    applySessionDetail,
    fetchSessionDetail,
    runStateSnapshot,
    messageOperationStore: {},
    monotonicActionStopTimeoutMs: 1,
    monotonicActionStopPollIntervalMs: 1,
    applyRunStateEvent,
  });
  return {
    actions,
    activeSession,
    userMessage,
    deleteSessionMessagesFromApi,
    fetchSessionDetail,
    applySessionDetail,
    applyRunStateEvent,
  };
}

describe("monotonicMessageActions stop-window gates", () => {
  it("does not delete messages when the session run state machine blocks delete during stop confirmation", async () => {
    const runStateSnapshot = ref(createInitialSessionRunState());
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED, source: "test" },
    });
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions({ runStateSnapshot });

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(false);
    expect(deleteSessionMessagesFromApi).not.toHaveBeenCalled();
    expect(activeSession.value.messages).toHaveLength(2);
  });

  it("allows delete again after the backend stop terminal state releases the gate", async () => {
    const runStateSnapshot = ref(createInitialSessionRunState());
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED, source: "test" },
    });
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: {
        type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
        state: "user_stopped",
        sessionId: "s1",
        dialogProcessId: "dp1",
        turnScopeId: "turn-1",
        source: "test",
      },
    });
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: {
        type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
        sessionId: "s1",
        dialogProcessId: "dp1",
        turnScopeId: "turn-1",
        source: "test",
      },
    });
    const { actions, userMessage, deleteSessionMessagesFromApi } = createActions({ runStateSnapshot });

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(true);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(1);
  });

  it("refreshes the latest session version and retries once when delete-from returns a version conflict", async () => {
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi, fetchSessionDetail } = createActions();
    deleteSessionMessagesFromApi
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          ok: false,
          error: "session version conflict",
          errorCode: "SESSION_VERSION_CONFLICT",
          currentVersion: 2,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          session: { ...activeSession.value, messages: [], rawMessages: [], version: 3, revision: 3 },
        }),
      });

    const result = await actions.deleteMonotonicMessage(userMessage);

    expect(result).toBe(true);
    expect(fetchSessionDetail).toHaveBeenCalledTimes(1);
    expect(deleteSessionMessagesFromApi).toHaveBeenCalledTimes(2);
    expect(deleteSessionMessagesFromApi.mock.calls[0][0].expectedVersion).toBe(1);
    expect(deleteSessionMessagesFromApi.mock.calls[1][0].expectedVersion).toBe(2);
  });

  it("applies the top-level mutation version after deleting a stopped turn", async () => {
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions();
    deleteSessionMessagesFromApi.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "s1",
        sessionVersion: 2,
        session: { ...activeSession.value, messages: [], rawMessages: [] },
      }),
    });

    expect(await actions.deleteMonotonicMessage(userMessage)).toBe(true);
    expect(activeSession.value.version).toBe(2);
    expect(activeSession.value.revision).toBe(2);
  });

  it("deletes a stopped turn after its authoritative summary clears the temporary lock", async () => {
    const runStateSnapshot = ref(createInitialSessionRunState());
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED, source: "test" },
    });
    applySessionRunStateEvent({
      stateRef: runStateSnapshot,
      event: {
        type: SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
        source: "test",
      },
    });
    const applyRunStateEvent = vi.fn();
    const { actions, activeSession, userMessage, deleteSessionMessagesFromApi } = createActions({
      runStateSnapshot,
      applyRunStateEvent,
    });
    deleteSessionMessagesFromApi.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: "s1",
        sessionVersion: 2,
        session: { ...activeSession.value, messages: [], rawMessages: [] },
      }),
    });

    expect(await actions.deleteMonotonicMessage(userMessage)).toBe(true);
    expect(activeSession.value.messages).toHaveLength(0);
    expect(runStateSnapshot.value.state).toBe("idle");
    expect(applyRunStateEvent).not.toHaveBeenCalled();
  });
});
