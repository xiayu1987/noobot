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

describe("sessionRunStateMachine transition rules", () => {
  beforeEach(() => installStorage());

  it.each([
    {
      name: "applies local send from idle",
      current: { state: FrontendRunState.IDLE, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "c1" },
      canApply: true,
      nextState: BackendChannelState.SENDING,
    },
    {
      name: "ignores event from another session",
      current: { state: BackendChannelState.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s2", turnScopeId: "c1" },
      canApply: false,
      nextState: BackendChannelState.SENDING,
    },
    {
      name: "ignores event from another turn scope",
      current: { state: BackendChannelState.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", turnScopeId: "c2" },
      canApply: false,
      nextState: BackendChannelState.SENDING,
    },
    {
      name: "keeps stop lock against stale running event",
      current: { state: FrontendRunState.USER_STOP_REQUESTED, sessionId: "s1", seq: 2 },
      event: { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, state: "reconnecting", sessionId: "s1", seq: 1 },
      canApply: false,
      nextState: FrontendRunState.USER_STOP_REQUESTED,
    },
    {
      name: "keeps terminal state against non-terminal event",
      current: { state: FrontendRunState.FRONTEND_COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1", dialogProcessId: "d1" },
      canApply: false,
      nextState: FrontendRunState.FRONTEND_COMPLETED,
    },
    {
      name: "allows new local turn after terminal state",
      current: { state: FrontendRunState.FRONTEND_COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", turnScopeId: "c2" },
      canApply: true,
      nextState: BackendChannelState.SENDING,
    },
    {
      name: "applies terminal event for same dialog",
      current: { state: BackendChannelState.SENDING, sessionId: "s1", dialogProcessId: "d1", seq: 1 },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", dialogProcessId: "d1", seq: 2 },
      canApply: true,
      nextState: BackendChannelState.COMPLETED,
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
      current: { state: FrontendRunState.IDLE, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.MISSING_EVENT_STATE,
      canApply: false,
      nextState: FrontendRunState.IDLE,
    },
    {
      name: "local reset",
      current: { state: BackendChannelState.SENDING, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.LOCAL_RESET, sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.LOCAL_RESET,
      canApply: true,
      nextState: FrontendRunState.IDLE,
    },
    {
      name: "different scope",
      current: { state: BackendChannelState.SENDING, sessionId: "s1", turnScopeId: "c1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", turnScopeId: "c2" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.DIFFERENT_SCOPE,
      canApply: false,
      nextState: BackendChannelState.SENDING,
    },
    {
      name: "stop lock reopen",
      current: { state: FrontendRunState.USER_STOP_REQUESTED, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.USER_STOP_LOCK_REOPEN,
      canApply: false,
      nextState: FrontendRunState.USER_STOP_REQUESTED,
    },
    {
      name: "terminal lock reopen",
      current: { state: FrontendRunState.FRONTEND_COMPLETED, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1", dialogProcessId: "d1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
      canApply: false,
      nextState: FrontendRunState.FRONTEND_COMPLETED,
    },
    {
      name: "stale seq regression",
      current: { state: FrontendRunState.USER_STOPPING, sessionId: "s1", seq: 3 },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: FrontendRunState.USER_STOP_REQUESTED, sessionId: "s1", seq: 2 },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
      canApply: false,
      nextState: FrontendRunState.USER_STOPPING,
    },
    {
      name: "priority regression",
      current: { state: BackendChannelState.INTERACTION_PENDING, sessionId: "s1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
      canApply: false,
      nextState: BackendChannelState.INTERACTION_PENDING,
    },
    {
      name: "applied",
      current: { state: BackendChannelState.SENDING, sessionId: "s1", dialogProcessId: "d1" },
      event: { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "completed", sessionId: "s1", dialogProcessId: "d1" },
      reason: SESSION_RUN_TRANSITION_DECISION_REASON.APPLIED,
      canApply: true,
      nextState: BackendChannelState.COMPLETED,
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
      SESSION_RUN_TRANSITION_DECISION_REASON.USER_STOP_LOCK_REOPEN,
      SESSION_RUN_TRANSITION_DECISION_REASON.TERMINAL_LOCK_REOPEN,
      SESSION_RUN_TRANSITION_DECISION_REASON.STALE_SEQ_REGRESSION,
      SESSION_RUN_TRANSITION_DECISION_REASON.PRIORITY_REGRESSION,
    ];
    expect(SESSION_RUN_TRANSITION_GUARDS.map((guard) => guard.reason)).toEqual(orderedGuardReasons);
    expect(SESSION_RUN_TRANSITION_GUARDS.every((guard) => typeof guard.passes === "function")).toBe(true);
  });

  it("binds transition guards from the current state config", () => {
    expect(SESSION_RUN_TRANSITION_TABLE[BackendChannelState.SENDING]).toMatchObject({
      priority: 40,
      rule: "priority_forward",
    });
    expect(SESSION_RUN_TRANSITION_TABLE[BackendChannelState.SENDING].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
    expect(SESSION_RUN_TRANSITION_TABLE[FrontendRunState.USER_STOP_REQUESTED].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "user_stop_lock_not_reopened",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
    expect(SESSION_RUN_TRANSITION_TABLE[BackendChannelState.COMPLETED].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
    expect(SESSION_RUN_TRANSITION_TABLE[FrontendRunState.FRONTEND_COMPLETED].guards).toEqual([
      "has_event_state",
      "same_conversation_scope_or_new_turn",
      "terminal_not_reopened",
      "no_stale_seq_regression",
      "priority_forward_or_new_turn",
    ]);
  });

  it("keeps backend and frontend state boundaries explicit", () => {
    expect(BackendChannelState.COMPLETED).toBe("completed");
    expect(FrontendRunState.FRONTEND_COMPLETED).toBe("frontend_completed");

    expect(BackendTerminalStates).toEqual([
      BackendChannelState.COMPLETED,
      BackendChannelState.USER_STOPPED,
      BackendChannelState.ERROR,
      BackendChannelState.EXPIRED,
      BackendChannelState.NO_CONVERSATION,
    ]);
    expect(FrontendTerminalStates).toContain(FrontendRunState.FRONTEND_COMPLETED);
    expect(FrontendTerminalStates).toContain(FrontendRunState.USER_STOP_COMPLETED);
    expect(FrontendTerminalStates).not.toContain(BackendChannelState.COMPLETED);
    expect(FrontendTerminalStates).not.toContain(BackendChannelState.USER_STOPPED);
    expect(evaluateSessionRunState({ state: BackendChannelState.COMPLETED })).toMatchObject({
      sending: true,
      terminal: false,
    });
    expect(evaluateSessionRunState({ state: FrontendRunState.FRONTEND_COMPLETED })).toMatchObject({
      sending: false,
      terminal: true,
    });
  });

  it("keeps user_stop_requested locked when stale running/reconnecting events arrive", () => {
    const stopped = reduceSessionRunEvents(createInitialSessionRunState(), [
      { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1", seq: 1 },
      { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, sessionId: "s1", seq: 2 },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, state: "reconnecting", sessionId: "s1", seq: 1 },
    ]);
    expect(stopped.state).toBe(FrontendRunState.USER_STOP_REQUESTED);
    expect(evaluateSessionRunState(stopped)).toMatchObject({ sending: true, canStop: false });
  });

  it("reduces same batch running plus stopping/stopped to frontend user-stop completion", () => {
    const state = reduceSessionRunEvents(createInitialSessionRunState(), [
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1", seq: 1 },
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "stopping", sessionId: "s1", seq: 2 },
      { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "user_stopped", sessionId: "s1", seq: 3 },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1", seq: 1 },
    ]);
    expect(state.state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(state.backendState).toBe(BackendChannelState.USER_STOPPED);
    expect(evaluateSessionRunState(state)).toMatchObject({ sending: false, canStop: false, terminal: true });
  });

  it("filters different scope but allows a new send turn after terminal", () => {
    const current = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "d1",
    });
    expect(transitionSessionRunState(current, { type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE, state: "sending", sessionId: "s2" }).state).toBe(FrontendRunState.USER_STOP_COMPLETED);
    expect(transitionSessionRunState(current, { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1" }).state).toBe(BackendChannelState.SENDING);
  });

  it("accepts a newer backend terminal fact for the same run identity", () => {
    const stopped = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      seq: 10,
    });
    const completed = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      seq: 11,
    });
    expect(completed).toMatchObject({
      state: BackendChannelState.COMPLETED,
      backendState: BackendChannelState.COMPLETED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      seq: 11,
    });
  });

  it("applies the same terminal fact rule without depending on user_stopped", () => {
    const failed = createInitialSessionRunState({
      state: BackendChannelState.ERROR,
      backendState: BackendChannelState.ERROR,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      seq: 20,
    });
    const corrected = transitionSessionRunState(failed, {
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: BackendChannelState.COMPLETED,
      sessionId: "s1",
      dialogProcessId: "dialog-1",
      turnScopeId: "turn-1",
      seq: 21,
    });
    expect(corrected).toMatchObject({
      state: BackendChannelState.COMPLETED,
      backendState: BackendChannelState.COMPLETED,
      seq: 21,
    });
  });

  it("does not let another turn completion clear user_stopped", () => {
    const stopped = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
      seq: 10,
    });
    const delayedOtherCompletion = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: "completed",
      sessionId: "s1",
      dialogProcessId: "dialog-other",
      turnScopeId: "turn-other",
      seq: 11,
    });
    expect(delayedOtherCompletion).toBe(stopped);
  });

  it("lets an authoritative reconnect snapshot replace an older stopped turn", () => {
    const stopped = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_COMPLETED,
      backendState: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-stopped",
      turnScopeId: "turn-stopped",
      seq: 10,
    });
    const completed = transitionSessionRunState(stopped, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: BackendChannelState.COMPLETED,
      sessionId: "s1",
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      seq: 21,
      authoritativeSnapshot: true,
    });
    expect(completed).toMatchObject({
      state: BackendChannelState.COMPLETED,
      backendState: BackendChannelState.COMPLETED,
      sessionId: "s1",
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      seq: 21,
    });
  });

  it("keeps a new local send scoped by turnScopeId until backend binds dialog id", () => {
    const current = createInitialSessionRunState({
      state: FrontendRunState.USER_STOP_REQUESTED,
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
      state: BackendChannelState.SENDING,
      dialogProcessId: "",
      turnScopeId: "client-new",
    });
    expect(evaluateSessionRunState(next)).toMatchObject({ sending: true, canStop: true });

    const staleTerminal = transitionSessionRunState(next, {
      type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
      state: "user_stopped",
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
      state: BackendChannelState.RECONNECTING,
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      seq: 3,
      updatedAt: Date.parse("2026-06-22T08:00:00.000Z"),
    });
    expect(evaluateSessionRunState(bound)).toMatchObject({ sending: true, canStop: true });
  });

  it("ignores stale user_stop replay for a different identified turn", () => {
    const current = createInitialSessionRunState({
      state: BackendChannelState.ERROR,
      sessionId: "s1",
      dialogProcessId: "dialog-new",
      turnScopeId: "turn-new",
      seq: 0,
      priority: 120,
    });

    const staleReplay = transitionSessionRunState(current, {
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: BackendChannelState.USER_STOPPED,
      sessionId: "s1",
      dialogProcessId: "dialog-old",
      turnScopeId: "turn-old",
      seq: 57,
      source: "reconnect",
    });

    expect(staleReplay).toBe(current);
  });

  it("requires matching turnScopeId after backend dialogProcessId is bound", () => {
    const bound = createInitialSessionRunState({
      state: BackendChannelState.SENDING,
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
      state: BackendChannelState.COMPLETED,
      dialogProcessId: "new-dialog",
      turnScopeId: "client-new",
      updatedAt: 1710000005000,
    });
    expect(evaluateSessionRunState(realCompleted)).toMatchObject({ sending: true, canStop: false, terminal: false });
  });

  it("does not treat dialogProcessId and turnScopeId as interchangeable scopes", () => {
    const current = createInitialSessionRunState({
      state: BackendChannelState.SENDING,
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
      nextState: BackendChannelState.SENDING,
    });
    expect(transitionSessionRunState(current, event)).toBe(current);
  });

  it("applies events to refs from the state machine only", () => {
    const stateRef = ref(createInitialSessionRunState());
    const sending = ref(false);
    const canStop = ref(false);
    applySessionRunStateEvent({ stateRef, sending, canStop, event: { type: SESSION_RUN_EVENT.LOCAL_SEND_STARTED, sessionId: "s1" } });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([BackendChannelState.SENDING, true, true]);
    applySessionRunStateEvents({ stateRef, sending, canStop, events: [
      { type: SESSION_RUN_EVENT.LOCAL_USER_STOP_REQUESTED, sessionId: "s1" },
      { type: SESSION_RUN_EVENT.BACKEND_RECOVERABLE_RUNNING, sessionId: "s1" },
    ] });
    expect([stateRef.value.state, sending.value, canStop.value]).toEqual([FrontendRunState.USER_STOP_REQUESTED, true, false]);
  });
});
