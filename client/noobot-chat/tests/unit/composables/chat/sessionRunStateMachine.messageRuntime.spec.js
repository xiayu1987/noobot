import { describe, expect, it, beforeEach } from "vitest";
import { ref } from "vue";
import {
  BackendChannelState,
  BackendTerminalStates,
  FrontendRunState,
  FrontendTerminalStates,
  SESSION_RUN_EVENT,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
  SESSION_RUN_TRANSITION_DECISION_REASON,
  SESSION_RUN_TRANSITION_GUARDS,
  SESSION_RUN_TRANSITION_TABLE,
  applySessionRunStateEvent,
  applySessionRunStateEvents,
  clearRememberedStopRequests,
  createInitialSessionRunState,
  evaluateSessionRunState,
  canApplyEvent,
  normalizeSessionRunEvent,
  reduceSessionRunEvents,
  rememberStopRequestedEvent,
  resolveEventScope,
  resolveNextStateByTransitionTable,
  resolveRememberedStopRequestedEvent,
  getMessageRuntimeChannelState,
  isMessageInFlightAssistant,
  isMessageRunning,
  resolveSessionRunMessageRuntimeView,
  resolveSessionRunMessageRuntimePatch,
  resolveSessionRunStateForMessage,
  resolveTransitionDecision,
  transitionSessionRunState,
} from "../../../../src/composables/chat/sessionRunStateMachine";

function installStorage() {
  const map = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
      clear: () => map.clear(),
    },
  });
}

describe("sessionRunStateMachine message runtime", () => {
  beforeEach(() => installStorage());

  it("resolves in-flight state for a matching assistant message", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1", content: "" };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };
    const stateSnapshot = createInitialSessionRunState({
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      priority: 40,
    });

    expect(resolveSessionRunStateForMessage({ stateSnapshot, messageItem: assistant, activeSession })).toBe(stateSnapshot);
  });

  it("does not resolve terminal or different-session run state for a message", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1", content: "" };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(resolveSessionRunStateForMessage({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.FRONTEND_COMPLETED,
        sessionId: "s1",
        dialogProcessId: "d1",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toBeNull();
    expect(resolveSessionRunStateForMessage({
      stateSnapshot: createInitialSessionRunState({
        state: BackendChannelState.SENDING,
        sessionId: "s2",
        dialogProcessId: "d1",
        priority: 40,
      }),
      messageItem: assistant,
      activeSession,
    })).toBeNull();
  });

  it("resolves message runtime effects from state machine rules", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1", content: "" };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };
    const stateSnapshot = createInitialSessionRunState({
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      priority: 40,
    });

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot,
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.IN_FLIGHT_MATCH,
      patch: {
        runtimeMark: "sending|s1|d1|turn-1|",
        pending: true,
        channelState: {
          state: BackendChannelState.SENDING,
          sessionId: "s1",
          dialogProcessId: "d1",
          turnScopeId: "turn-1",
        },
      },
    });

    assistant[SESSION_RUN_MESSAGE_RUNTIME_MARK] = "sending|s1|d1||0";
    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.FRONTEND_COMPLETED,
        sessionId: "s1",
        dialogProcessId: "d1",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: {
        clearRuntimeMark: true,
        pending: false,
        channelState: { state: FrontendRunState.FRONTEND_COMPLETED },
        statusLabelKey: "chat.generated",
      },
    });

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: BackendChannelState.COMPLETED,
        sessionId: "s1",
        dialogProcessId: "other-dialog",
        turnScopeId: "other-turn",
        priority: 90,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE,
    });
  });

  it("does not clear active message runtime from another session terminal state", () => {
    const assistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "d-active",
      turnScopeId: "turn-active",
      content: "",
      [SESSION_RUN_MESSAGE_RUNTIME_MARK]: "sending|s-active|d-active|turn-active|",
      channelState: {
        state: BackendChannelState.SENDING,
        sessionId: "s-active",
        dialogProcessId: "d-active",
        turnScopeId: "turn-active",
      },
      realtimeLogs: [{ event: "tool_call", type: "tool_call", text: "running" }],
    };
    const activeSession = {
      id: "s-active",
      backendSessionId: "s-active",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.FRONTEND_COMPLETED,
        sessionId: "s-other",
        dialogProcessId: "d-other",
        turnScopeId: "turn-other",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE,
    });

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.USER_STOP_COMPLETED,
        backendState: BackendChannelState.USER_STOPPED,
        sessionId: "s-other",
        dialogProcessId: "d-other",
        turnScopeId: "turn-other",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE,
    });
  });

  it("does not regress finalized stopped assistant to in-flight runtime patch", () => {
    const assistant = {
      role: "assistant",
      pending: false,
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      channelState: { state: BackendChannelState.USER_STOPPED, dialogProcessId: "d1", turnScopeId: "turn-1" },
      statusLabel: "已停止",
    };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.USER_STOPPING,
        backendState: BackendChannelState.STOPPING,
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
        sourceEvent: "user_stop_requested_registry",
        priority: 70,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({ action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE });
  });

  it("applies backend stopped snapshot to refreshed pending assistant matched by dialogProcessId", () => {
    const assistant = {
      role: "assistant",
      pending: true,
      dialogProcessId: "d1",
      turnScopeId: "",
      content: "",
    };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q", turnScopeId: "turn-1" }, assistant],
    };

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: FrontendRunState.USER_STOP_COMPLETED,
        backendState: BackendChannelState.USER_STOPPED,
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
        sourceEvent: "user_stopped",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: {
        pending: false,
        channelState: {
          state: BackendChannelState.USER_STOPPED,
          sessionId: "s1",
          dialogProcessId: "d1",
          turnScopeId: "turn-1",
        },
        statusLabelKey: "chat.stopped",
      },
    });
  });

  it("resolves obsolete previous pending assistant as clear_runtime", () => {
    const oldAssistant = {
      role: "assistant",
      pending: true,
      channelState: { state: "sending" },
      content: "old",
    };
    const latestAssistant = { role: "assistant", pending: false, content: "new" };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [
        { role: "user", content: "old q" },
        oldAssistant,
        { role: "user", content: "new q" },
        latestAssistant,
      ],
    };

    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: BackendChannelState.SENDING,
        sessionId: "s1",
      }),
      messageItem: oldAssistant,
      activeSession,
    })).toMatchObject({
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.OBSOLETE_PENDING_ASSISTANT,
      patch: {
        clearRuntimeMark: true,
        pending: false,
        channelState: { state: FrontendRunState.FRONTEND_COMPLETED },
      },
    });
  });

  it("resolves message runtime selector from normalized and legacy message shapes", () => {
    const sendingMessage = {
      role: "assistant",
      pending: true,
      channelState: {
        state: BackendChannelState.SENDING,
        sessionId: "s1",
        dialogProcessId: "d1",
        turnScopeId: "turn-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdAtMs: 1000,
      },
      thinkingStartedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(getMessageRuntimeChannelState(sendingMessage)).toMatchObject({
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
    });
    expect(resolveSessionRunMessageRuntimeView(sendingMessage)).toMatchObject({
      state: BackendChannelState.SENDING,
      pending: true,
      running: true,
      inFlightAssistant: true,
      canStopTarget: true,
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(isMessageRunning(sendingMessage)).toBe(true);
    expect(isMessageInFlightAssistant(sendingMessage)).toBe(true);

    expect(resolveSessionRunMessageRuntimeView({
      role: "assistant",
      channel_state: { status: "reconnecting" },
    })).toMatchObject({
      state: BackendChannelState.RECONNECTING,
      running: true,
      inFlightAssistant: true,
      canStopTarget: true,
    });

    expect(resolveSessionRunMessageRuntimeView({
      role: "assistant",
      channelState: "interaction_pending",
    })).toMatchObject({
      state: BackendChannelState.INTERACTION_PENDING,
      running: true,
      inFlightAssistant: true,
      canStopTarget: true,
    });

    expect(resolveSessionRunMessageRuntimeView({
      role: "assistant",
      status: FrontendRunState.USER_STOP_REQUESTED,
      pending: true,
    })).toMatchObject({
      state: FrontendRunState.USER_STOP_REQUESTED,
      running: true,
      inFlightAssistant: true,
      canStopTarget: false,
    });

    expect(resolveSessionRunMessageRuntimeView({
      role: "user",
      pending: true,
    })).toMatchObject({
      running: true,
      inFlightAssistant: false,
      canStopTarget: false,
    });
  });
});
