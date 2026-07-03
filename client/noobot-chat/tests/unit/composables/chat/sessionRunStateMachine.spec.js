import { describe, expect, it, beforeEach } from "vitest";
import { ref } from "vue";
import {
  SESSION_RUN_EVENT,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
  SESSION_RUN_STATE,
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

describe("sessionRunStateMachine", () => {
  beforeEach(() => installStorage());

  it("normalizes known event aliases and evaluates derived UI state", () => {
    const event = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "running",
      sessionId: " s1 ",
      turnScopeId: " c1 ",
    });
    expect(event.state).toBe(SESSION_RUN_STATE.SENDING);
    expect(event.sessionId).toBe("s1");
    expect(event.turnScopeId).toBe("c1");
    expect(evaluateSessionRunState({ state: SESSION_RUN_STATE.STOPPING })).toMatchObject({
      sending: true,
      canStop: false,
      assistantStatus: "stopping",
      stopLocked: true,
    });
  });

  it("keeps composer action request flags in the session run state machine", () => {
    const initial = createInitialSessionRunState();
    const sendRequesting = transitionSessionRunState(initial, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    });
    expect(sendRequesting.state).toBe(SESSION_RUN_STATE.IDLE);
    expect(evaluateSessionRunState(sendRequesting).composerActionState).toEqual({
      sendRequesting: true,
      stopRequesting: false,
      stopPendingUntilBackendReady: false,
    });

    const backendSending = transitionSessionRunState(sendRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(backendSending)).toMatchObject({
      sending: true,
      canStop: true,
      composerActionState: {
        sendRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });

    const stopRequesting = transitionSessionRunState(backendSending, {
      type: SESSION_RUN_EVENT.LOCAL_STOP_REQUEST_STARTED,
    });
    expect(evaluateSessionRunState(stopRequesting).composerActionState).toEqual({
      sendRequesting: false,
      stopRequesting: true,
      stopPendingUntilBackendReady: false,
    });

    const stopRequested = transitionSessionRunState(stopRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_STOP_REQUESTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopRequested)).toMatchObject({
      sending: true,
      canStop: false,
      composerActionState: {
        sendRequesting: false,
        stopRequesting: true,
        stopPendingUntilBackendReady: false,
      },
    });

    const stopped = transitionSessionRunState(stopRequested, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopped",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopped)).toMatchObject({
      sending: false,
      canStop: false,
      composerActionState: {
        sendRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });
  });

  it("keeps an early stop intent pending until backend stop is available", () => {
    const sendRequesting = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    });
    const pendingStop = transitionSessionRunState(sendRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_STOP_PENDING_BACKEND_READY,
    });
    expect(evaluateSessionRunState(pendingStop)).toMatchObject({
      sending: false,
      canStop: true,
      backendCanStop: false,
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
      composerActionState: {
        sendRequesting: true,
        stopRequesting: true,
        stopPendingUntilBackendReady: true,
      },
    });

    const backendReady = transitionSessionRunState(pendingStop, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(backendReady)).toMatchObject({
      sending: true,
      canStop: true,
      backendCanStop: true,
      stopInFlight: false,
      awaitingBackendStop: false,
      canStartNewSend: true,
      canRetryMessage: true,
      canDeleteMessage: true,
      composerActionState: {
        sendRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });
  });

  it("locks new send, resend, and delete while backend stop confirmation is pending", () => {
    const sending = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    const stopRequesting = transitionSessionRunState(sending, {
      type: SESSION_RUN_EVENT.LOCAL_STOP_REQUEST_STARTED,
    });
    expect(evaluateSessionRunState(stopRequesting)).toMatchObject({
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });

    const stopping = transitionSessionRunState(stopRequesting, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopping)).toMatchObject({
      stopInFlight: true,
      awaitingBackendStop: true,
      canStartNewSend: false,
      canRetryMessage: false,
      canDeleteMessage: false,
    });

    const stopped = transitionSessionRunState(stopping, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopped",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopped)).toMatchObject({
      stopInFlight: false,
      awaitingBackendStop: false,
      canStartNewSend: true,
      canRetryMessage: true,
      canDeleteMessage: true,
    });
  });

  it("scopes local turns by turnScopeId and binds backend dialogProcessId", () => {
    const firstTurn = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(firstTurn).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-1",
    });

    const staleScopedTerminal = transitionSessionRunState(firstTurn, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      turnScopeId: "client-old",
    });
    expect(staleScopedTerminal).toBe(firstTurn);

    const sameClientRunning = transitionSessionRunState(firstTurn, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(sameClientRunning).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      turnScopeId: "client-1",
    });

    const bound = transitionSessionRunState(sameClientRunning, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
      dialogProcessId: "dialog-1",
      seq: 2,
      createdAtMs: 1710000000000,
    });
    expect(bound).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      turnScopeId: "client-1",
      dialogProcessId: "dialog-1",
      seq: 2,
      updatedAt: 1710000000000,
    });
  });

  it("reopens an old stopped turn when resend starts with a fresh turnScopeId", () => {
    const stopped = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopped",
      sessionId: "s1",
      turnScopeId: "turn-old",
      seq: 3,
    });
    expect(stopped).toMatchObject({
      state: SESSION_RUN_STATE.STOPPED,
      turnScopeId: "turn-old",
    });

    const replacing = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId: "s1",
      turnScopeId: "turn-new",
    });
    expect(replacing).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_REPLACING_TURN,
      turnScopeId: "turn-new",
      dialogProcessId: "",
    });

    const streaming = transitionSessionRunState(replacing, {
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
      sessionId: "s1",
      turnScopeId: "turn-new",
    });
    expect(streaming).toMatchObject({
      state: SESSION_RUN_STATE.RESEND_STREAMING,
      turnScopeId: "turn-new",
    });
    expect(evaluateSessionRunState(streaming)).toMatchObject({
      sending: true,
      canStop: true,
    });
  });

  it("does not replay a remembered stop request onto a different turnScopeId", () => {
    rememberStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "turn-old",
    });

    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "turn-new",
    })).toBeNull();

    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "turn-old",
    })).toMatchObject({
      state: SESSION_RUN_STATE.STOP_REQUESTED,
      turnScopeId: "turn-old",
    });
  });

  it("keeps local send active by turnScopeId until real dialog id binds", () => {
    const localStarted = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(localStarted).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      turnScopeId: "client-1",
    });

    const localSendingEcho = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(localSendingEcho).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      lastEventType: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      turnScopeId: "client-1",
    });

    const unscopedCompleted = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
    });
    expect(unscopedCompleted).toBe(localSendingEcho);

    const unscopedStopping = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
    });
    expect(unscopedStopping).toBe(localSendingEcho);
    expect(evaluateSessionRunState(unscopedStopping)).toMatchObject({ sending: true, canStop: true });

    const bound = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      seq: 2,
    });
    expect(bound).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });

    const completed = transitionSessionRunState(bound, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      seq: 3,
    });
    expect(completed).toMatchObject({
      state: SESSION_RUN_STATE.COMPLETED,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
  });

  it("does not let unscoped local failures clear an unbound turn scope", () => {
    const localStarted = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });

    const localSendingEcho = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(localSendingEcho).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-1",
      lastEventType: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
    });

    const staleSessionOnlyFailure = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.LOCAL_FAILURE,
      state: "error",
      sessionId: "s1",
      source: "expired_refresh_failed",
    });
    expect(staleSessionOnlyFailure).toBe(localSendingEcho);
    expect(evaluateSessionRunState(staleSessionOnlyFailure)).toMatchObject({
      sending: true,
      canStop: true,
    });

    const sameClientFailure = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.LOCAL_FAILURE,
      state: "error",
      sessionId: "s1",
      turnScopeId: "client-1",
      source: "interaction_payload_missing",
    });
    expect(sameClientFailure).toMatchObject({
      state: SESSION_RUN_STATE.ERROR,
      turnScopeId: "client-1",
    });
  });

  it("keeps stop available while backend waits for interaction payload", () => {
    const started = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "session-int",
      turnScopeId: "client-int",
    });

    const interactionPending = transitionSessionRunState(started, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "interaction_pending",
      sessionId: "session-int",
      turnScopeId: "client-int",
      seq: 2,
    });

    expect(interactionPending).toMatchObject({
      state: SESSION_RUN_STATE.INTERACTION_PENDING,
      turnScopeId: "client-int",
    });
    expect(evaluateSessionRunState(interactionPending)).toMatchObject({
      sending: true,
      canStop: true,
    });
  });

  it("ignores accidental dialogProcessId on local send start and keeps turnScopeId as the unbound scope", () => {
    const localStarted = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      dialogProcessId: "existing-user-message-id",
      turnScopeId: "client-1",
    });
    expect(localStarted).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(localStarted)).toMatchObject({ sending: true, canStop: true });

    const localSendingEcho = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(localSendingEcho).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-1",
    });

    const staleStopping = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopping",
      sessionId: "s1",
    });
    expect(staleStopping).toBe(localSendingEcho);
    expect(evaluateSessionRunState(staleStopping)).toMatchObject({ sending: true, canStop: true });

    const bound = transitionSessionRunState(localSendingEcho, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
    expect(bound).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
  });

  it("resolves event scope from turn identity only", () => {
    expect(resolveEventScope({ dialogProcessId: " dialog-1 ", turnScopeId: " client-1 " })).toBe("client-1");
    expect(resolveEventScope({ turnScopeId: " turn-1 " })).toBe("turn-1");
    expect(resolveEventScope({ dialogProcessId: " dialog-1 " })).toBe("");
    expect(resolveEventScope({ dialogProcessId: " ", turnScopeId: " " })).toBe("");
  });

  it.each([
    {
      name: "applies local send from idle",
      current: { state: SESSION_RUN_STATE.IDLE, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "c1" },
      canApply: true,
      nextState: SESSION_RUN_STATE.SENDING,
    },
    {
      name: "ignores event from another session",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s2", turnScopeId: "c1" },
      canApply: false,
      nextState: SESSION_RUN_STATE.SENDING,
    },
    {
      name: "ignores event from another turn scope",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", turnScopeId: "c2" },
      canApply: false,
      nextState: SESSION_RUN_STATE.SENDING,
    },
    {
      name: "keeps stop lock against stale running event",
      current: { state: SESSION_RUN_STATE.STOP_REQUESTED, sessionId: "s1", seq: 2 },
      event: { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, state: "reconnecting", sessionId: "s1", seq: 1 },
      canApply: false,
      nextState: SESSION_RUN_STATE.STOP_REQUESTED,
    },
    {
      name: "keeps terminal state against non-terminal event",
      current: { state: SESSION_RUN_STATE.COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1", dialogProcessId: "d1" },
      canApply: false,
      nextState: SESSION_RUN_STATE.COMPLETED,
    },
    {
      name: "allows new local turn after terminal state",
      current: { state: SESSION_RUN_STATE.COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "c2" },
      canApply: true,
      nextState: SESSION_RUN_STATE.SENDING,
    },
    {
      name: "applies terminal event for same dialog",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1", dialogProcessId: "d1", seq: 1 },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", dialogProcessId: "d1", seq: 2 },
      canApply: true,
      nextState: SESSION_RUN_STATE.COMPLETED,
    },
  ])("transition table: $name", ({ current, event, canApply, nextState }) => {
    const state = createInitialSessionRunState(current);
    expect(canApplyEvent(state, event)).toBe(canApply);
    expect(resolveNextStateByTransitionTable(state, event)).toBe(nextState);
    expect(transitionSessionRunState(state, event).state).toBe(nextState);
  });

  it.each([
    {
      name: "missing normalized event state",
      current: { state: SESSION_RUN_STATE.IDLE, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.MISSING_EVENT_STATE,
      canApply: false,
      nextState: SESSION_RUN_STATE.IDLE,
    },
    {
      name: "local reset",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_RESET, sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.LOCAL_RESET,
      canApply: true,
      nextState: SESSION_RUN_STATE.IDLE,
    },
    {
      name: "different scope",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", turnScopeId: "c2" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
      canApply: false,
      nextState: SESSION_RUN_STATE.SENDING,
    },
    {
      name: "stop lock reopen",
      current: { state: SESSION_RUN_STATE.STOP_REQUESTED, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.STOP_LOCK_REOPEN,
      canApply: false,
      nextState: SESSION_RUN_STATE.STOP_REQUESTED,
    },
    {
      name: "terminal lock reopen",
      current: { state: SESSION_RUN_STATE.COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1", dialogProcessId: "d1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
      canApply: false,
      nextState: SESSION_RUN_STATE.COMPLETED,
    },
    {
      name: "stale seq regression",
      current: { state: SESSION_RUN_STATE.STOPPING, sessionId: "s1", seq: 3 },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "stop_requested", sessionId: "s1", seq: 2 },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
      canApply: false,
      nextState: SESSION_RUN_STATE.STOPPING,
    },
    {
      name: "priority regression",
      current: { state: SESSION_RUN_STATE.INTERACTION_PENDING, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
      canApply: false,
      nextState: SESSION_RUN_STATE.INTERACTION_PENDING,
    },
    {
      name: "applied",
      current: { state: SESSION_RUN_STATE.SENDING, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", dialogProcessId: "d1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.APPLIED,
      canApply: true,
      nextState: SESSION_RUN_STATE.COMPLETED,
    },
  ])("transition decision reason: $name", ({ current, event, reason, canApply, nextState }) => {
    expect(resolveTransitionDecision(createInitialSessionRunState(current), event)).toEqual({
      canApply,
      reason,
      nextState,
    });
  });

  it("keeps transition guard table ordered by decision reason precedence", () => {
    const orderedGuardReasons = [
      SESSION_RUN_TRANSITION_DECISION_REASON.MISSING_EVENT_STATE,
      SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
      SESSION_RUN_TRANSITION_DECISION_REASON.STOP_LOCK_REOPEN,
      SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
      SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
      SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
    ];
    expect(SESSION_RUN_TRANSITION_GUARDS.map((guard) => guard.reason)).toEqual(orderedGuardReasons);
    expect(SESSION_RUN_TRANSITION_GUARDS.every((guard) => typeof guard.passes === "function")).toBe(true);
  });

  it("binds transition guards from the current state config", () => {
    expect(SESSION_RUN_TRANSITION_TABLE[SESSION_RUN_STATE.SENDING]).toMatchObject({
      priority: 40,
      rule: "priority_forward",
    });
    expect(SESSION_RUN_TRANSITION_TABLE[SESSION_RUN_STATE.SENDING].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
    expect(SESSION_RUN_TRANSITION_TABLE[SESSION_RUN_STATE.STOP_REQUESTED].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "stop_lock_not_reopened",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
    expect(SESSION_RUN_TRANSITION_TABLE[SESSION_RUN_STATE.COMPLETED].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "terminal_not_reopened",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
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

  it("keeps a new local send scoped by turnScopeId until backend binds dialog id", () => {
    const current = createInitialSessionRunState({
      state: SESSION_RUN_STATE.STOP_REQUESTED,
      sessionId: "s1",
      dialogProcessId: "old-dialog",
      turnScopeId: "client-old",
      priority: 70,
    });
    const next = transitionSessionRunState(current, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-new",
    });

    expect(next).toMatchObject({
      state: SESSION_RUN_STATE.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-new",
    });
    expect(evaluateSessionRunState(next)).toMatchObject({ sending: true, canStop: true });

    const staleTerminal = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "stopped",
      sessionId: "s1",
      dialogProcessId: "old-dialog",
      turnScopeId: "client-old",
    });
    expect(staleTerminal).toBe(next);

    const bound = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "reconnecting",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      seq: 3,
      createdAt: "2026-06-22T08:00:00.000Z",
    });
    expect(bound).toMatchObject({
      state: SESSION_RUN_STATE.RECONNECTING,
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      seq: 3,
      updatedAt: Date.parse("2026-06-22T08:00:00.000Z"),
    });
    expect(evaluateSessionRunState(bound)).toMatchObject({ sending: true, canStop: true });
  });

  it("requires matching turnScopeId after backend dialogProcessId is bound", () => {
    const bound = createInitialSessionRunState({
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "s1",
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      priority: 40,
    });

    const staleSameDialogDifferentTurn = transitionSessionRunState(bound, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
      turnScopeId: "client-old",
    });
    expect(staleSameDialogDifferentTurn).toBe(bound);

    const realCompleted = transitionSessionRunState(bound, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      updatedAtMs: 1710000005000,
    });
    expect(realCompleted).toMatchObject({
      state: SESSION_RUN_STATE.COMPLETED,
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      updatedAt: 1710000005000,
    });
    expect(evaluateSessionRunState(realCompleted)).toMatchObject({ sending: false, canStop: false, terminal: true });
  });

  it("does not treat dialogProcessId and turnScopeId as interchangeable scopes", () => {
    const current = createInitialSessionRunState({
      state: SESSION_RUN_STATE.SENDING,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      priority: 40,
    });

    const event = {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      turnScopeId: "client-1",
    };

    expect(resolveTransitionDecision(current, event)).toMatchObject({
      canApply: false,
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
      nextState: SESSION_RUN_STATE.SENDING,
    });
    expect(transitionSessionRunState(current, event)).toBe(current);
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
    })?.state).toBe(SESSION_RUN_STATE.STOP_REQUESTED);
    clearRememberedStopRequests({ sessionId: "s1", dialogProcessId: "d1", turnScopeId: "turn-1" });
    expect(resolveRememberedStopRequestedEvent({
      sessionId: "s1",
      dialogProcessId: "d1",
      turnScopeId: "turn-1",
    })).toBeNull();
  });

  it("resolves in-flight state for a matching assistant message", () => {
    const assistant = { role: "assistant", dialogProcessId: "d1", turnScopeId: "turn-1", content: "" };
    const activeSession = {
      id: "s1",
      backendSessionId: "s1",
      messages: [{ role: "user", content: "q" }, assistant],
    };
    const stateSnapshot = createInitialSessionRunState({
      state: SESSION_RUN_STATE.SENDING,
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
        state: SESSION_RUN_STATE.COMPLETED,
        sessionId: "s1",
        dialogProcessId: "d1",
        priority: 100,
      }),
      messageItem: assistant,
      activeSession,
    })).toBeNull();
    expect(resolveSessionRunStateForMessage({
      stateSnapshot: createInitialSessionRunState({
        state: SESSION_RUN_STATE.SENDING,
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
      state: SESSION_RUN_STATE.SENDING,
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
          state: SESSION_RUN_STATE.SENDING,
          sessionId: "s1",
          dialogProcessId: "d1",
          turnScopeId: "turn-1",
        },
      },
    });

    assistant[SESSION_RUN_MESSAGE_RUNTIME_MARK] = "sending|s1|d1||0";
    expect(resolveSessionRunMessageRuntimePatch({
      stateSnapshot: createInitialSessionRunState({
        state: SESSION_RUN_STATE.COMPLETED,
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
        channelState: { state: SESSION_RUN_STATE.COMPLETED },
        statusLabelKey: "chat.generated",
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
        state: SESSION_RUN_STATE.SENDING,
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
        channelState: { state: SESSION_RUN_STATE.COMPLETED },
      },
    });
  });
});
