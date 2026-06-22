import { describe, expect, it, beforeEach } from "vitest";
import { ref } from "vue";
import {
  SESSION_RUN_EVENT,
  SESSION_RUN_STATE,
  applySessionRunStateEvent,
  applySessionRunStateEvents,
  clearRememberedStopRequests,
  createInitialSessionRunState,
  evaluateSessionRunState,
  normalizeSessionRunEvent,
  reduceSessionRunEvents,
  rememberStopRequestedEvent,
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

describe("sessionRunStateMachine", () => {
  beforeEach(() => installStorage());

  it("normalizes known event aliases and evaluates derived UI state", () => {
    const event = normalizeSessionRunEvent({ type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "running", sessionId: " s1 " });
    expect(event.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(event.sessionId).toBe("s1");
    expect(evaluateSessionRunState({ state: SESSION_RUN_STATE.STOPPING })).toMatchObject({
      sending: true,
      canStop: false,
      assistantStatus: "stopping",
      stopLocked: true,
    });
  });

  it("keeps stop_requested locked when stale running/reconnecting events arrive", () => {
    const stopped = reduceSessionRunEvents(createInitialSessionRunState(), [
      { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", seq: 1 },
      { type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED, sessionId: "s1", seq: 2 },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, state: "reconnecting", sessionId: "s1", seq: 1 },
    ]);
    expect(stopped.state).toBe(SESSION_RUN_STATE.STOP_REQUESTED);
    expect(evaluateSessionRunState(stopped)).toMatchObject({ sending: true, canStop: false });
  });

  it("reduces same batch running plus stopping/stopped to terminal stopped", () => {
    const state = reduceSessionRunEvents(createInitialSessionRunState(), [
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1", seq: 1 },
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "stopping", sessionId: "s1", seq: 2 },
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "stopped", sessionId: "s1", seq: 3 },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1", seq: 1 },
    ]);
    expect(state.state).toBe(SESSION_RUN_STATE.STOPPED);
    expect(evaluateSessionRunState(state)).toMatchObject({ sending: false, canStop: false, terminal: true });
  });

  it("filters different scope but allows a new send turn after terminal", () => {
    const current = createInitialSessionRunState({ state: SESSION_RUN_STATE.STOPPED, sessionId: "s1", dialogProcessId: "d1" });
    expect(transitionSessionRunState(current, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s2" }).state).toBe(SESSION_RUN_STATE.STOPPED);
    expect(transitionSessionRunState(current, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1" }).state).toBe(SESSION_RUN_STATE.SENDING);
  });

  it("keeps local send stoppable until backend binds the new dialog id", () => {
    const current = createInitialSessionRunState({
      state: SESSION_RUN_STATE.STOP_REQUESTED,
      sessionId: "s1",
      dialogProcessId: "old-dialog",
      priority: 70,
    });
    const next = transitionSessionRunState(current, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
    });

    expect(next.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(next.dialogProcessId).toBe("old-dialog");
    expect(next.dialogProcessBound).toBe(false);
    expect(evaluateSessionRunState(next)).toMatchObject({ sending: true, canStop: true });

    const staleTerminal = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopped",
      sessionId: "s1",
      dialogProcessId: "old-dialog",
    });
    expect(staleTerminal.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(evaluateSessionRunState(staleTerminal)).toMatchObject({ sending: true, canStop: true });

    const staleUnscopedTerminal = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
    });
    expect(staleUnscopedTerminal.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(evaluateSessionRunState(staleUnscopedTerminal)).toMatchObject({ sending: true, canStop: true });

    const staleUnscopedStopping = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
    });
    expect(staleUnscopedStopping.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(evaluateSessionRunState(staleUnscopedStopping)).toMatchObject({ sending: true, canStop: true });

    const bound = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "reconnecting",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
    });
    expect(bound.state).toBe(SESSION_RUN_STATE.RECONNECTING);
    expect(bound.dialogProcessId).toBe("new-dialog");
    expect(bound.dialogProcessBound).toBe(true);
    expect(evaluateSessionRunState(bound)).toMatchObject({ sending: true, canStop: true });
  });

  it("keeps local send stoppable after local unbound sending echo until backend binds dialog id", () => {
    const localStarted = transitionSessionRunState(createInitialSessionRunState({
      state: SESSION_RUN_STATE.COMPLETED,
      sessionId: "s1",
      dialogProcessId: "old-dialog",
      dialogProcessBound: true,
      priority: 100,
    }), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
    });

    expect(localStarted).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "old-dialog",
      dialogProcessBound: false,
      localSendUnbound: true,
    });
    expect(evaluateSessionRunState(localStarted)).toMatchObject({ sending: true, canStop: true });

    const localSendingEcho = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
    });
    expect(localSendingEcho).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "old-dialog",
      dialogProcessBound: false,
      localSendUnbound: true,
    });
    expect(evaluateSessionRunState(localSendingEcho)).toMatchObject({ sending: true, canStop: true });

    const staleUnscopedCompleted = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
    });
    expect(staleUnscopedCompleted).toBe(localSendingEcho);
    expect(evaluateSessionRunState(staleUnscopedCompleted)).toMatchObject({ sending: true, canStop: true });

    const staleUnscopedStopping = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
    });
    expect(staleUnscopedStopping).toBe(localSendingEcho);
    expect(evaluateSessionRunState(staleUnscopedStopping)).toMatchObject({ sending: true, canStop: true });

    const bound = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
    });
    expect(bound).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "new-dialog",
      dialogProcessBound: true,
      localSendUnbound: false,
    });
    expect(evaluateSessionRunState(bound)).toMatchObject({ sending: true, canStop: true });

    const realCompleted = transitionSessionRunState(bound, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
    });
    expect(realCompleted.state).toBe(SESSION_RUN_STATE.COMPLETED);
    expect(evaluateSessionRunState(realCompleted)).toMatchObject({ sending: false, canStop: false, terminal: true });
  });

  it("applies events to refs from the state machine only", () => {
    const stateRef = ref(createInitialSessionRunState());
    const sending = ref(false);
    const canStop = ref(false);
    applySessionRunStateEvent({ stateRef, sending, canStop, event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1" } });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([SESSION_RUN_STATE.SENDING, true, true]);
    applySessionRunStateEvents({ stateRef, sending, canStop, events: [
      { type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED, sessionId: "s1" },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1" },
    ] });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([SESSION_RUN_STATE.STOP_REQUESTED, true, false]);
  });

  it("persists remembered stop requests and clears them on terminal", () => {
    rememberStopRequestedEvent({ sessionId: "s1", dialogProcessId: "d1", timestamp: Date.now() });
    expect(resolveRememberedStopRequestedEvent({ sessionId: "s1", dialogProcessId: "d1" })?.state).toBe(SESSION_RUN_STATE.STOP_REQUESTED);
    clearRememberedStopRequests({ sessionId: "s1", dialogProcessId: "d1" });
    expect(resolveRememberedStopRequestedEvent({ sessionId: "s1", dialogProcessId: "d1" })).toBeNull();
  });
});
