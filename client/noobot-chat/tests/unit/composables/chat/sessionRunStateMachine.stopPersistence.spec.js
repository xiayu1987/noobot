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

describe("sessionRunStateMachine remembered stop requests", () => {
  beforeEach(() => installStorage());

  it("persists remembered stop requests and clears them on terminal", () => {
    rememberStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
      timestamp: Date.now(),
    });
    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
    })).toBeNull();
    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
    })?.state).toBe(FrontendRunState.USER_STOP_REQUESTED);
    clearRememberedStopRequests({ sessionId: "s1", dialogProcessId: "d1", turnScopeId: "turn-1" });
    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
    })).toBeNull();
  });
});
