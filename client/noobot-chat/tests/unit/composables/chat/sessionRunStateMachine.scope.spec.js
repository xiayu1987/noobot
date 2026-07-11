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

describe("sessionRunStateMachine turn scope", () => {
  beforeEach(() => installStorage());

  it("scopes local turns by turnScopeId and binds backend dialogProcessId", () => {
    const firstTurn = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(firstTurn).toMatchObject({
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.SENDING,
      turnScopeId: "client-1",
      dialogProcessId: "dialog-1",
      seq: 2,
      updatedAt: 1710000000000,
    });
  });

  it("reopens an old stopped turn when resend starts with a fresh turnScopeId", () => {
    const stopped = transitionSessionRunState(createInitialSessionRunState(), {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
      sessionId: "s1",
      turnScopeId: "turn-old",
      seq: 3,
    });
    expect(stopped).toMatchObject({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      turnScopeId: "turn-old",
    });

    const replacing = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      sessionId: "s1",
      turnScopeId: "turn-new",
    });
    expect(replacing).toMatchObject({
      state: FrontendRunState.RESEND_REPLACING_TURN,
      turnScopeId: "turn-new",
      dialogProcessId: "",
    });

    const streaming = transitionSessionRunState(replacing, {
      type: SESSION_RUN_EVENT.LOCAL_RESEND_STREAMING,
      sessionId: "s1",
      turnScopeId: "turn-new",
    });
    expect(streaming).toMatchObject({
      state: FrontendRunState.RESEND_STREAMING,
      turnScopeId: "turn-new",
    });
    expect(evaluateSessionRunState(streaming)).toMatchObject({
      sending: true,
      canStop: true,
    });

    const staleStoppedReplay = transitionSessionRunState(streaming, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
      sessionId: "s1",
      turnScopeId: "turn-old",
      seq: 4,
    });
    expect(staleStoppedReplay).toBe(streaming);

    const backendCompleted = transitionSessionRunState(streaming, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "dialog-new",
      turnScopeId: "turn-new",
      seq: 5,
    });
    expect(backendCompleted).toMatchObject({
      state: BackendChannelState.COMPLETED,
      dialogProcessId: "dialog-new",
      turnScopeId: "turn-new",
    });
    expect(evaluateSessionRunState(backendCompleted)).toMatchObject({ sending: true, terminal: false });

    const frontendCompleted = transitionSessionRunState(backendCompleted, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      dialogProcessId: "dialog-new",
      turnScopeId: "turn-new",
      seq: 6,
    });
    expect(frontendCompleted).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      dialogProcessId: "dialog-new",
      turnScopeId: "turn-new",
    });
    expect(evaluateSessionRunState(frontendCompleted)).toMatchObject({ sending: false, terminal: true });
  });

  it.each([
    {
      label: "send",
      startEvent: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      startState: BackendChannelState.SENDING,
      newTurnScopeId: "turn-send-new",
      backendDialogProcessId: "dialog-send-new",
    },
    {
      label: "continue",
      startEvent: SESSION_RUN_EVENT.LOCAL_CONTINUE_REQUEST_STARTED,
      startState: FrontendRunState.CONTINUE_REQUESTING,
      newTurnScopeId: "turn-continue-new",
      backendDialogProcessId: "dialog-continue-new",
    },
    {
      label: "resend",
      startEvent: SESSION_RUN_EVENT.LOCAL_RESEND_STARTED,
      startState: FrontendRunState.RESEND_REPLACING_TURN,
      backendBoundState: FrontendRunState.RESEND_REPLACING_TURN,
      newTurnScopeId: "turn-resend-new",
      backendDialogProcessId: "dialog-resend-new",
    },
  ])("starts $label as a new scoped turn after user stop and completes through frontend completion", ({
    startEvent,
    startState,
    backendBoundState = BackendChannelState.SENDING,
    newTurnScopeId,
    backendDialogProcessId,
  }) => {
    const stopped = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
      seq: 10,
      priority: 90,
    });

    const started = transitionSessionRunState(stopped, {
      type: startEvent,
      sessionId: "s1",
      dialogProcessId: "dialog-old-should-not-leak",
      turnScopeId: newTurnScopeId,
      seq: 11,
    });

    expect(started).toMatchObject({
      state: startState,
      backendState: "",
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: newTurnScopeId,
    });
    expect(started.dialogProcessId).not.toBe("dialog-old");
    expect(evaluateSessionRunState(started)).toMatchObject({ sending: true, canStop: true, terminal: false });

    const staleOldStopped = transitionSessionRunState(started, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
      seq: 12,
    });
    expect(staleOldStopped).toBe(started);

    const backendBound = transitionSessionRunState(started, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      dialogProcessId: backendDialogProcessId,
      turnScopeId: newTurnScopeId,
      seq: 13,
    });
    expect(backendBound).toMatchObject({
      state: backendBoundState,
      dialogProcessId: backendDialogProcessId,
      turnScopeId: newTurnScopeId,
    });

    const backendCompleted = transitionSessionRunState(backendBound, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: backendDialogProcessId,
      turnScopeId: newTurnScopeId,
      seq: 14,
    });
    expect(backendCompleted).toMatchObject({ state: BackendChannelState.COMPLETED });
    expect(evaluateSessionRunState(backendCompleted)).toMatchObject({ sending: true, terminal: false });

    const frontendCompleted = transitionSessionRunState(backendCompleted, {
      type: SESSION_RUN_EVENT.LOCAL_FRONTEND_COMPLETION_APPLIED,
      sessionId: "s1",
      dialogProcessId: backendDialogProcessId,
      turnScopeId: newTurnScopeId,
      seq: 15,
    });
    expect(frontendCompleted).toMatchObject({
      state: FrontendRunState.FRONTEND_COMPLETED,
      dialogProcessId: backendDialogProcessId,
      turnScopeId: newTurnScopeId,
      composerActionState: {
        sendRequesting: false,
        continueRequesting: false,
        stopRequesting: false,
        stopPendingUntilBackendReady: false,
      },
    });
    expect(evaluateSessionRunState(frontendCompleted)).toMatchObject({ sending: false, terminal: true });
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
      state: FrontendRunState.USER_STOP_REQUESTED,
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
      state: BackendChannelState.SENDING,
      turnScopeId: "client-1",
    });

    const localSendingEcho = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "sending",
      sessionId: "s1",
      turnScopeId: "client-1",
    });
    expect(localSendingEcho).toMatchObject({
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.COMPLETED,
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
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.ERROR,
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
      state: BackendChannelState.INTERACTION_PENDING,
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
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.SENDING,
      dialogProcessId: "dialog-1",
      turnScopeId: "client-1",
    });
  });

  it("keeps continue resume identity out of the current run dialog binding", () => {
    const localStarted = transitionSessionRunState(createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dp-stopped",
      turnScopeId: "turn-stopped",
    }), {
      type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED,
      sessionId: "s1",
      turnScopeId: "turn-new",
      source: "continue",
    });

    expect(localStarted.backendState).toBe("");
    const continueStarted = transitionSessionRunState(localStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      turnScopeId: "turn-new",
      sourceEvent: "continue_started",
      resumeDialogProcessId: "dp-stopped",
      resumeTurnScopeId: "turn-stopped",
      seq: 2,
    });

    expect(continueStarted).toMatchObject({
      state: BackendChannelState.SENDING,
      backendState: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "",
      turnScopeId: "turn-new",
    });

    const realRunBound = transitionSessionRunState(continueStarted, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.SENDING,
      sessionId: "s1",
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
      seq: 3,
    });

    expect(realRunBound).toMatchObject({
      state: BackendChannelState.SENDING,
      dialogProcessId: "dp-new",
      turnScopeId: "turn-new",
    });
  });

  it("resolves event scope from turn identity only", () => {
    expect(resolveEventScope({ dialogProcessId: " dialog-1 ", turnScopeId: " client-1 " })).toBe("client-1");
    expect(resolveEventScope({ turnScopeId: " turn-1 " })).toBe("turn-1");
    expect(resolveEventScope({ dialogProcessId: " dialog-1 " })).toBe("");
    expect(resolveEventScope({ dialogProcessId: " ", turnScopeId: " " })).toBe("");
  });
});
