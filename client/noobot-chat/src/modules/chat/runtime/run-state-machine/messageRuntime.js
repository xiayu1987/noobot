/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../model/messageIdentity.js";
import {
  AGENT_CHANNEL_STATE,
  FrontendRunState,
  MESSAGE_IN_FLIGHT_CHANNEL_STATES,
  MESSAGE_TERMINAL_OUTCOME,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
} from "./constants.js";
import { createInitialSessionRunState, isInFlightSessionRunState } from "./core.js";
import { normalizeState, trim } from "./normalize.js";
import { isTerminalRunState, resolveStateTerminalOutcome } from "./terminalOutcome.js";
import { isPlainObject } from "@noobot/shared/value";

const MESSAGE_RUNNING_CHANNEL_STATES = Object.freeze([
  AGENT_CHANNEL_STATE.SENDING,
  AGENT_CHANNEL_STATE.RECONNECTING,
  AGENT_CHANNEL_STATE.INTERACTION_PENDING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  FrontendRunState.USER_STOPPING,
]);

export function isFinalizedAssistantMessage(messageItem) {
  if (getMessageRole(messageItem) !== "assistant") return false;
  return (
    messageItem.pending !== true &&
    isTerminalRunState(getMessageRuntimeChannelState(messageItem).state)
  );
}

function terminalSnapshotOwnsMessage(stateSnapshot = {}, messageItem = {}, activeSession = {}) {
  if (getMessageRole(messageItem) !== "assistant") return false;
  if (!isRunStateForActiveSession(stateSnapshot, activeSession)) return false;
  const runTurnScopeId = trim(stateSnapshot?.turnScopeId);
  const messageTurnScopeId = getMessageTurnScopeId(messageItem);
  return Boolean(runTurnScopeId && messageTurnScopeId && runTurnScopeId === messageTurnScopeId);
}

function isRunStateForActiveSession(stateSnapshot = {}, activeSession = {}) {
  const stateSessionId = trim(stateSnapshot?.sessionId);
  if (!stateSessionId) return true;
  const activeSessionId = trim(activeSession?.sessionId);
  return !activeSessionId || activeSessionId === stateSessionId;
}

function getLatestAssistantMessage(activeSession = {}) {
  const messages = Array.isArray(activeSession?.messages) ? activeSession.messages : [];
  return [...messages].reverse().find((item = {}) => getMessageRole(item) === "assistant") || null;
}

export function resolveSessionRunStateForMessage({
  stateSnapshot = createInitialSessionRunState(),
  messageItem = {},
  activeSession = {},
} = {}) {
  const normalizedState = normalizeState(stateSnapshot?.state);
  if (!isInFlightSessionRunState(normalizedState)) return null;
  if (getMessageRole(messageItem) !== "assistant") return null;
  if (!isRunStateForActiveSession(stateSnapshot, activeSession)) return null;

  const runDialogProcessId = trim(stateSnapshot?.dialogProcessId);
  const runTurnScopeId = trim(stateSnapshot?.turnScopeId);
  const messageDialogProcessId = getMessageDialogProcessId(messageItem);
  const messageTurnScopeId = getMessageTurnScopeId(messageItem);

  if (runTurnScopeId && messageTurnScopeId && runTurnScopeId === messageTurnScopeId) {
    return stateSnapshot;
  }
  if (runDialogProcessId && messageDialogProcessId) {
    if (runTurnScopeId && messageTurnScopeId && runTurnScopeId !== messageTurnScopeId) return null;
    return runDialogProcessId === messageDialogProcessId ? stateSnapshot : null;
  }
  return null;
}

function buildSessionRunMessageRuntimeKey(stateItem = {}) {
  return [
    stateItem?.state,
    stateItem?.sessionId,
    stateItem?.dialogProcessId,
    stateItem?.turnScopeId,
    stateItem?.createdAtMs,
  ]
    .map((item) => trim(item).replaceAll("|", "/"))
    .join("|");
}

export function getMessageRuntimeChannelState(messageItem = {}) {
  const channelState = messageItem?.channelState;
  if (!isPlainObject(channelState)) return {};
  return { ...channelState, state: normalizeState(channelState.state) };
}

const EMPTY_TURN_RUNTIME = Object.freeze({
  state: "",
  backendState: "",
  displayState: "",
  startedAt: "",
  finishedAt: "",
  modelLoopRound: 0,
});

export function resolveTurnRuntimeView({ messageItem = {}, runtime = EMPTY_TURN_RUNTIME } = {}) {
  const channelState = getMessageRuntimeChannelState(messageItem);
  const runtimeState = normalizeState(runtime.state);
  const state = isTerminalRunState(runtimeState)
    ? runtimeState
    : normalizeState(runtime.backendState || runtime.state || channelState?.state);
  const pending = messageItem?.pending === true;
  const terminal = isTerminalRunState(state);
  const running = !terminal && (pending || MESSAGE_RUNNING_CHANNEL_STATES.includes(state));
  const inFlightAssistant =
    getMessageRole(messageItem) === "assistant" &&
    (running || (!terminal && MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(state)));
  return {
    state,
    displayState: runtime.displayState,
    channelState,
    pending,
    running,
    terminal,
    inFlightAssistant,
    startedAt: runtime.startedAt,
    finishedAt: runtime.finishedAt,
    modelLoopRound: runtime.modelLoopRound,
  };
}

export function resolveSessionRunMessageRuntimeView(messageItem = {}) {
  return resolveTurnRuntimeView({ messageItem });
}

export function isMessageRunning(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).running;
}

export function isMessageInFlightAssistant(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).inFlightAssistant;
}

function buildInFlightMessageRuntimePatch(stateItem = {}) {
  const channelState = {
    state: normalizeState(stateItem?.backendState) || normalizeState(stateItem?.state),
    sourceEvent: trim(stateItem?.sourceEvent),
  };
  return {
    [SESSION_RUN_MESSAGE_RUNTIME_MARK]: buildSessionRunMessageRuntimeKey(stateItem),
    pending: true,
    channelState,
  };
}

function buildClearMessageRuntimePatch() {
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: FrontendRunState.FRONTEND_COMPLETED,
    },
    terminalOutcome: MESSAGE_TERMINAL_OUTCOME.GENERATED,
  };
}

function buildFailedMessageRuntimePatch({ stateSnapshot = createInitialSessionRunState() } = {}) {
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: normalizeState(stateSnapshot?.state) || AGENT_CHANNEL_STATE.ERROR,
    },
    terminalOutcome: MESSAGE_TERMINAL_OUTCOME.FAILED,
  };
}

function buildStoppedMessageRuntimePatch({
  messageItem = {},
  stateSnapshot = createInitialSessionRunState(),
} = {}) {
  const channelState = getMessageRuntimeChannelState(messageItem);
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: AGENT_CHANNEL_STATE.USER_STOPPED,
      sourceEvent:
        trim(stateSnapshot?.sourceEvent) || trim(channelState?.sourceEvent) || "user_stopped",
    },
    terminalOutcome: MESSAGE_TERMINAL_OUTCOME.STOPPED,
  };
}

function isObsoletePendingAssistantMessage(messageItem = {}, activeSession = {}) {
  if (!messageItem || getMessageRole(messageItem) !== "assistant") return false;
  if (messageItem.pending !== true) return false;
  const latestAssistant = getLatestAssistantMessage(activeSession);
  if (!latestAssistant || latestAssistant === messageItem) return false;
  return MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(
    normalizeState(getMessageRuntimeChannelState(messageItem)?.state),
  );
}

export function resolveSessionRunMessageRuntimePatch({
  stateSnapshot = createInitialSessionRunState(),
  messageItem = {},
  activeSession = {},
} = {}) {
  const stateBelongsToActiveSession = isRunStateForActiveSession(stateSnapshot, activeSession);
  const terminalOwnsMessage = terminalSnapshotOwnsMessage(
    stateSnapshot,
    messageItem,
    activeSession,
  );
  const stateItem = resolveSessionRunStateForMessage({
    stateSnapshot,
    messageItem,
    activeSession,
  });
  if (
    stateBelongsToActiveSession &&
    terminalOwnsMessage &&
    normalizeState(stateSnapshot?.backendState) === AGENT_CHANNEL_STATE.USER_STOPPED
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildStoppedMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  if (stateItem) {
    if (isFinalizedAssistantMessage(messageItem)) {
      return { action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE };
    }
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.IN_FLIGHT_MATCH,
      stateItem,
      patch: buildInFlightMessageRuntimePatch(stateItem),
    };
  }
  if (
    stateBelongsToActiveSession &&
    (normalizeState(stateSnapshot?.state) === FrontendRunState.USER_STOP_COMPLETED ||
      normalizeState(stateSnapshot?.backendState) === AGENT_CHANNEL_STATE.USER_STOPPED) &&
    (terminalOwnsMessage ||
      messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] ||
      resolveSessionRunStateForMessage({
        stateSnapshot: { ...stateSnapshot, state: FrontendRunState.USER_STOPPING },
        messageItem,
        activeSession,
      }))
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildStoppedMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  if (
    stateBelongsToActiveSession &&
    terminalOwnsMessage &&
    resolveStateTerminalOutcome(stateSnapshot?.state) === MESSAGE_TERMINAL_OUTCOME.FAILED
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildFailedMessageRuntimePatch({ stateSnapshot }),
    };
  }
  if (
    stateBelongsToActiveSession &&
    terminalOwnsMessage &&
    normalizeState(stateSnapshot?.state) === FrontendRunState.FRONTEND_COMPLETED &&
    stateSnapshot?.lifecycleObserved === true
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildClearMessageRuntimePatch(),
    };
  }
  if (
    stateBelongsToActiveSession &&
    isObsoletePendingAssistantMessage(messageItem, activeSession)
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.OBSOLETE_PENDING_ASSISTANT,
      patch: buildClearMessageRuntimePatch(),
    };
  }
  return { action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE };
}
