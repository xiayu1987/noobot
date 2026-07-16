/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import {
  normalizeTimePair,
  nowMs,
  toIsoTime,
} from "../../infra/timeFields";
import {
  BackendChannelState,
  BackendTerminalStates,
  FrontendRunState,
  FrontendTerminalStates,
  MESSAGE_IN_FLIGHT_CHANNEL_STATES,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
  SESSION_RUN_MESSAGE_RUNTIME_REASON,
} from "./constants";
import { createInitialSessionRunState, isInFlightSessionRunState } from "./core";
import { normalizeState, trim } from "./normalize";

const MESSAGE_RUNNING_CHANNEL_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
  FrontendRunState.FRONTEND_COMPLETION_REQUESTING,
  FrontendRunState.USER_STOPPING,
]);

const MESSAGE_CAN_STOP_TARGET_STATES = Object.freeze([
  BackendChannelState.SENDING,
  BackendChannelState.RECONNECTING,
  BackendChannelState.INTERACTION_PENDING,
  FrontendRunState.RESEND_REPLACING_TURN,
  FrontendRunState.RESEND_STREAMING,
]);

function isTerminalMessageRuntimeState(state = "") {
  const normalizedState = normalizeState(state);
  return BackendTerminalStates.includes(normalizedState) || FrontendTerminalStates.includes(normalizedState);
}

function isFinalizedAssistantMessage(messageItem = {}) {
  if (getMessageRole(messageItem) !== "assistant") return false;
  const channelState = getMessageChannelState(messageItem);
  const state = normalizeState(channelState?.state);
  return messageItem?.pending === false && isTerminalMessageRuntimeState(state);
}

export function isRunStateForActiveSession(stateSnapshot = {}, activeSession = {}) {
  const stateSessionId = trim(stateSnapshot?.sessionId);
  if (!stateSessionId) return true;
  const activeIds = [
    activeSession?.id,
    activeSession?.backendSessionId,
  ].map((item) => trim(item)).filter(Boolean);
  return !activeIds.length || activeIds.includes(stateSessionId);
}

export function getLatestAssistantMessage(activeSession = {}) {
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

export function buildSessionRunMessageRuntimeKey(stateItem = {}) {
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

export function getMessageChannelState(messageItem = {}) {
  const channelState = messageItem?.channelState;
  const legacyChannelState = messageItem?.channel_state;
  if (channelState && typeof channelState === "object" && !Array.isArray(channelState)) {
    return { ...channelState, state: normalizeState(channelState.state || channelState.status) };
  }
  if (legacyChannelState && typeof legacyChannelState === "object" && !Array.isArray(legacyChannelState)) {
    return { ...legacyChannelState, state: normalizeState(legacyChannelState.state || legacyChannelState.status) };
  }
  const state = normalizeState(
    typeof channelState === "string"
      ? channelState
      : typeof legacyChannelState === "string"
        ? legacyChannelState
        : messageItem?.status || messageItem?.state,
  );
  return state ? { state } : {};
}

export const getMessageRuntimeChannelState = getMessageChannelState;

export function resolveTurnRuntimeView({
  messageItem = {},
  turnTiming = null,
  turnStatus = null,
  realtimeState = null,
} = {}) {
  const channelState = getMessageChannelState(messageItem);
  const realtimeStatus = normalizeState(
    realtimeState?.backendState || realtimeState?.state || channelState?.state,
  );
  const persistedStatus = normalizeState(turnStatus?.status || turnStatus?.state);
  const messageStatus = normalizeState(messageItem?.status || messageItem?.state);
  // A persisted terminal fact is monotonic and must win over a late realtime
  // event. Before persistence catches up, the realtime state fills the gap.
  const state = isTerminalMessageRuntimeState(persistedStatus)
    ? persistedStatus
    : realtimeStatus || persistedStatus || messageStatus;
  const pending = messageItem?.pending === true;
  const hasStartedAt = Boolean(turnTiming?.thinkingStartedAt);
  const hasFinishedAt = Boolean(turnTiming?.thinkingFinishedAt);
  const terminal = isTerminalMessageRuntimeState(state);
  // Session detail snapshots intentionally do not persist transient message
  // channelState/pending fields.  A persisted start without a finish or a
  // terminal status is therefore the authoritative in-flight fact after a
  // refresh.
  const running = !hasFinishedAt && !terminal && (
    hasStartedAt || pending || MESSAGE_RUNNING_CHANNEL_STATES.includes(state)
  );
  const inFlightAssistant = getMessageRole(messageItem) === "assistant" && (
    running || (!hasFinishedAt && !terminal && MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(state))
  );
  const canStopTarget = inFlightAssistant && (
    MESSAGE_CAN_STOP_TARGET_STATES.includes(state) || (pending && !state)
  );
  return {
    state,
    channelState,
    pending,
    running,
    inFlightAssistant,
    canStopTarget,
    startedAt: turnTiming?.thinkingStartedAt || "",
    finishedAt: turnTiming?.thinkingFinishedAt || "",
    source: isTerminalMessageRuntimeState(persistedStatus)
      ? "persisted"
      : realtimeStatus
        ? "realtime"
        : persistedStatus
          ? "persisted"
          : "message",
  };
}

export function resolveSessionRunMessageRuntimeView(messageItem = {}, turnTiming = null, turnStatus = null) {
  return resolveTurnRuntimeView({ messageItem, turnTiming, turnStatus });
}

export function isMessageRunning(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).running;
}

export function isMessageInFlightAssistant(messageItem = {}) {
  return resolveSessionRunMessageRuntimeView(messageItem).inFlightAssistant;
}

export function buildInFlightMessageRuntimePatch(stateItem = {}) {
  const timing = normalizeTimePair(stateItem);
  const channelState = {
    state: normalizeState(stateItem?.backendState) || normalizeState(stateItem?.state),
    sessionId: trim(stateItem?.sessionId),
    dialogProcessId: trim(stateItem?.dialogProcessId),
    turnScopeId: trim(stateItem?.turnScopeId),
    sourceEvent: trim(stateItem?.sourceEvent),
    seq: Number(stateItem?.seq || 0),
  };
  return {
    [SESSION_RUN_MESSAGE_RUNTIME_MARK]: buildSessionRunMessageRuntimeKey(stateItem),
    runtimeMark: buildSessionRunMessageRuntimeKey(stateItem),
    pending: true,
    channelState,
    thinkingStartedAt: timing.createdAt || timing.createdAtMs || "",
    thinkingStartedAtPolicy: "if_missing",
  };
}

export function buildClearMessageRuntimePatch({
  messageItem = {},
  stateSnapshot = createInitialSessionRunState(),
} = {}) {
  const stateTiming = normalizeTimePair(stateSnapshot);
  const channelState = getMessageChannelState(messageItem);
  const finishedAt = stateTiming.updatedAt || toIsoTime(nowMs());
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: FrontendRunState.FRONTEND_COMPLETED,
    },
    thinkingFinishedAt: finishedAt,
    thinkingFinishedAtPolicy: "if_missing",
    statusLabelKey: "chat.generated",
    statusLabelPolicy: "if_empty",
  };
}

export function buildFailedMessageRuntimePatch({
  messageItem = {},
  stateSnapshot = createInitialSessionRunState(),
} = {}) {
  const stateTiming = normalizeTimePair(stateSnapshot);
  const channelState = getMessageChannelState(messageItem);
  const finishedAt = stateTiming.updatedAt || toIsoTime(nowMs());
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: BackendChannelState.ERROR,
    },
    thinkingFinishedAt: finishedAt,
    thinkingFinishedAtPolicy: "if_missing",
    statusLabelKey: "chat.failed",
  };
}

export function buildStoppedMessageRuntimePatch({
  messageItem = {},
  stateSnapshot = createInitialSessionRunState(),
} = {}) {
  const stateTiming = normalizeTimePair(stateSnapshot);
  const channelState = getMessageChannelState(messageItem);
  const finishedAt = stateTiming.updatedAt || toIsoTime(nowMs());
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: BackendChannelState.USER_STOPPED,
      sessionId: trim(channelState?.sessionId),
      dialogProcessId: getMessageDialogProcessId(messageItem) || trim(channelState?.dialogProcessId),
      turnScopeId: getMessageTurnScopeId(messageItem) || trim(channelState?.turnScopeId),
      sourceEvent: trim(stateSnapshot?.sourceEvent) || trim(channelState?.sourceEvent) || "user_stopped",
      seq: Number(stateSnapshot?.seq || channelState?.seq || 0),
    },
    thinkingFinishedAt: finishedAt,
    thinkingFinishedAtPolicy: "if_missing",
    statusLabelKey: "chat.stopped",
  };
}

export function isObsoletePendingAssistantMessage(messageItem = {}, activeSession = {}) {
  if (!messageItem || getMessageRole(messageItem) !== "assistant") return false;
  if (messageItem.pending !== true) return false;
  const latestAssistant = getLatestAssistantMessage(activeSession);
  if (!latestAssistant || latestAssistant === messageItem) return false;
  return MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(
    normalizeState(getMessageChannelState(messageItem)?.state),
  );
}

export function resolveSessionRunMessageRuntimePatch({
  stateSnapshot = createInitialSessionRunState(),
  messageItem = {},
  activeSession = {},
} = {}) {
  const stateBelongsToActiveSession = isRunStateForActiveSession(stateSnapshot, activeSession);
  const stateItem = resolveSessionRunStateForMessage({
    stateSnapshot,
    messageItem,
    activeSession,
  });
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
    (
      normalizeState(stateSnapshot?.state) === FrontendRunState.USER_STOP_COMPLETED ||
      normalizeState(stateSnapshot?.backendState) === BackendChannelState.USER_STOPPED
    ) &&
    (
      messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] ||
      resolveSessionRunStateForMessage({
        stateSnapshot: { ...stateSnapshot, state: FrontendRunState.USER_STOPPING },
        messageItem,
        activeSession,
      })
    )
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildStoppedMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  if (
    stateBelongsToActiveSession &&
    normalizeState(stateSnapshot?.state) === BackendChannelState.ERROR &&
    messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK]
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildFailedMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  if (
    stateBelongsToActiveSession &&
    normalizeState(stateSnapshot?.state) === FrontendRunState.FRONTEND_COMPLETED &&
    messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK]
  ) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.RUNTIME_STATE_NO_LONGER_MATCHES,
      patch: buildClearMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  if (isObsoletePendingAssistantMessage(messageItem, activeSession)) {
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.OBSOLETE_PENDING_ASSISTANT,
      patch: buildClearMessageRuntimePatch({ messageItem, stateSnapshot }),
    };
  }
  return { action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.NONE };
}

export const resolveSessionRunMessageRuntimeEffect = resolveSessionRunMessageRuntimePatch;
