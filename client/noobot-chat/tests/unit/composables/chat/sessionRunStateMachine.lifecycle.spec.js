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

describe("sessionRunStateMachine lifecycle", () => {
  beforeEach(() => installStorage());

  it("normalizes known event aliases and evaluates derived UI state", () => {
    const event = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "running",
      sessionId: " s1 ",
      turnScopeId: " c1 ",
    });
    expect(event.state).toBe(BackendChannelState.SENDING);
    expect(event.sessionId).toBe("s1");
    expect(event.turnScopeId).toBe("c1");
    const stoppingEvent = normalizeSessionRunEvent({
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.STOPPING,
      sessionId: "s1",
    });
    expect(stoppingEvent).toMatchObject({
      state: FrontendRunState.USER_STOPPING,
      backendState: BackendChannelState.STOPPING,
    });
    expect(evaluateSessionRunState({ state: FrontendRunState.USER_STOPPING })).toMatchObject({
      sending: true,
      canStop: false,
      assistantStatus: "user_stopping",
      stopLocked: true,
    });
  });

  it("keeps composer action request flags in the session run state machine", () => {
    const initial = createInitialSessionRunState();
    const sendRequesting = transitionSessionRunState(initial, {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    });
    expect(sendRequesting.state).toBe(FrontendRunState.IDLE);
    expect(evaluateSessionRunState(sendRequesting).composerActionState).toEqual({
      sendRequesting: true,
      continueRequesting: false,
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
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });

    const stopRequesting = transitionSessionRunState(backendSending, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
    });
    expect(evaluateSessionRunState(stopRequesting).composerActionState).toEqual({
      sendRequesting: false,
      continueRequesting: false,
      stopRequesting: true,
      stopPendingUntilBackendReady: false,
    });

    const stopRequested = transitionSessionRunState(stopRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopRequested)).toMatchObject({
      sending: true,
      canStop: false,
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: true,
        stopPendingUntilBackendReady: false,
      },
    });

    const stopped = transitionSessionRunState(stopRequested, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
    expect(stopped).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(stopped)).toMatchObject({
      sending: false,
      canStop: false,
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });

    const continueRequesting = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
      sessionId: "s1",
      turnScopeId: "client-continue-1",
    });
    expect(continueRequesting).toMatchObject({
      state: FrontendRunState.CONTINUE_REQUESTING,
      backendState: "",
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "client-continue-1",
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });
    expect(evaluateSessionRunState(continueRequesting)).toMatchObject({
      sending: true,
      canStop: true,
      terminal: false,
    });

    const continueSettled = transitionSessionRunState(continueRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_SETTLED,
    });
    expect(continueSettled).toMatchObject({
      state: FrontendRunState.CONTINUE_REQUESTING,
      backendState: "",
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "client-continue-1",
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });

    const frontendCompleted = transitionSessionRunState(continueSettled, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      dialogProcessId: "dialog-continue-1",
      turnScopeId: "client-continue-1",
      seq: 3,
    });
    expect(frontendCompleted).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      backendState: "",
      sessionId: "s1",
      dialogProcessId: "dialog-continue-1",
      turnScopeId: "client-continue-1",
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });
    expect(evaluateSessionRunState(frontendCompleted)).toMatchObject({
      sending: false,
      terminal: true,
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
      },
    });
  });

  it("requires frontend completion after backend completed before a turn is terminal", () => {
    const sending = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });

    const backendCompleted = transitionSessionRunState(sending, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      seq: 2,
    });

    expect(backendCompleted).toMatchObject({
      state: BackendChannelState.COMPLETED,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
    expect(evaluateSessionRunState(backendCompleted)).toMatchObject({
      sending: true,
      terminal: false,
      assistantStatus: "",
    });

    const requesting = transitionSessionRunState(backendCompleted, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_REQUEST_STARTED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      seq: 3,
    });
    expect(requesting.state).toBe(FrontendRunState.FRONTEND_COMPLETION_REQUESTING);
    expect(evaluateSessionRunState(requesting)).toMatchObject({
      sending: true,
      terminal: false,
      assistantStatus: "",
    });

    const completed = transitionSessionRunState(requesting, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
      seq: 4,
    });
    expect(completed.state).toBe(FrontendRunState.FRONTEND_COMPLETED);
    expect(evaluateSessionRunState(completed)).toMatchObject({
      sending: false,
      terminal: true,
      assistantStatus: "generated",
    });
  });

  it("resets backend sequence when continue starts a new turn", () => {
    const stopped = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
      seq: 38,
    });
    const continued = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
      sessionId: "s1",
      turnScopeId: "turn-current",
    });
    const firstBackendState = transitionSessionRunState(continued, {
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      seq: 1,
    });

    expect(continued).toMatchObject({
      state: FrontendRunState.CONTINUE_REQUESTING,
      dialogProcessId: "",
      turnScopeId: "turn-current",
      seq: 0,
    });
    expect(firstBackendState).toMatchObject({
      state: BackendChannelState.SENDING,
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      seq: 1,
    });
  });

  it("keeps an early stop intent pending until backend stop is available", () => {
    const sendRequesting = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
    });
    const pendingStop = transitionSessionRunState(sendRequesting, {
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_PENDING_BACKEND_READY,
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
      type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUEST_STARTED,
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
      state: "user_stopped",
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
});
