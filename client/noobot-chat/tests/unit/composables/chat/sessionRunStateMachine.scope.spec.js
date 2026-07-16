import { beforeEach, describe, expect, it } from "vitest";
import {
  FrontendRunState,
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
  createInitialSessionRunState,
  evaluateSessionRunState,
  rememberStopRequestedEvent,
  resolveEventScope,
  resolveRememberedStopRequestedEvent,
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

const identity = {
  sessionId: "s1",
  dialogProcessId: "dialog-1",
  turnScopeId: "turn-1",
};

function expectNoTurnIdentity(state) {
  expect(state).not.toHaveProperty("sessionId");
  expect(state).not.toHaveProperty("dialogProcessId");
  expect(state).not.toHaveProperty("turnScopeId");
  expect(state).not.toHaveProperty("backendState");
  expect(state).not.toHaveProperty("action");
}

describe("sessionRunStateMachine scope separation", () => {
  beforeEach(() => {
    installStorage();
    clearRememberedStopRequests();
  });

  it.each([
    SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
    SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
  ])("uses a global action lock for %s without retaining the new turn identity", (type) => {
    const next = transitionSessionRunState(createInitialSessionRunState(), { type, ...identity });

    expect(next.state).toBe(FrontendRunState.ACTION_REQUESTING);
    expect(evaluateSessionRunState(next)).toMatchObject({
      sending: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });
    expectNoTurnIdentity(next);
  });

  it("promotes backend in-flight facts to the identity-free processing lock", () => {
    const started = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      ...identity,
    });

    for (const state of ["sending", "interaction_pending"]) {
      const next = transitionSessionRunState(started, {
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        ...identity,
      });
      expect(next.state).toBe(FrontendRunState.PROCESSING);
      expectNoTurnIdentity(next);
    }
  });

  it("uses distinct completion and stop locks without retaining turn identity", () => {
    const completion = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
      ...identity,
    });
    const stopping = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
      ...identity,
    });

    expect(completion.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    expect(stopping.state).toBe(FrontendRunState.USER_STOPPING);
    expectNoTurnIdentity(completion);
    expectNoTurnIdentity(stopping);
  });

  it.each([
    SESSION_RUN_EVENT.LOCAL_FAILURE,
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_FAILED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_FAILED,
  ])("clears the global lock on scoped or unscoped failure %s", (type) => {
    const started = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      ...identity,
    });
    const failed = transitionSessionRunState(started, { type, sessionId: "another-session" });

    expect(failed.state).toBe(FrontendRunState.IDLE);
    expect(evaluateSessionRunState(failed).sending).toBe(false);
    expectNoTurnIdentity(failed);
  });

  it.each([
    SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
    SESSION_RUN_EVENT.LOCAL_USER_STOP_SUMMARY_APPLIED,
  ])("clears the global lock after authoritative summary application via %s", (type) => {
    const locked = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
      ...identity,
    });
    const applied = transitionSessionRunState(locked, { type, ...identity });

    expect(applied.state).toBe(FrontendRunState.IDLE);
    expectNoTurnIdentity(applied);
  });

  it("keeps remembered stop requests scoped to the exact turn outside the global lock", () => {
    rememberStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
    });

    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-new",
    })).toBeNull();
    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
    })).toMatchObject({ turnScopeId: "turn-old" });
  });

  it("resolves event scope from turnScopeId only", () => {
    expect(resolveEventScope({ dialogProcessId: " dialog-1 ", turnScopeId: " client-1 " })).toBe("client-1");
    expect(resolveEventScope({ turnScopeId: " turn-1 " })).toBe("turn-1");
    expect(resolveEventScope({ dialogProcessId: " dialog-1 " })).toBe("");
    expect(resolveEventScope({ dialogProcessId: " ", turnScopeId: " " })).toBe("");
  });
});
