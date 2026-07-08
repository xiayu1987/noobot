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
  getThinkingFinishedAt,
  getThinkingStartedAt,
  normalizeTimePair,
  nowMs,
  parseTimeMs,
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
  FrontendRunState.STOP_REQUESTED,
  BackendChannelState.STOPPING,
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
  const state = normalizeState(channelState?.state || messageItem?.status || messageItem?.state || messageItem?.stopState);
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

function resolveRuntimeTimestamp({ thinkingStartedAt = "", thinkingFinishedAt = "" } = {}) {
  const startedAt = parseTimeMs(thinkingStartedAt) > 0 ? thinkingStartedAt : "";
  const finishedAt = parseTimeMs(thinkingFinishedAt) > 0 ? thinkingFinishedAt : "";
  return { startedAt, finishedAt };
}

export function resolveSessionRunMessageRuntimeView(messageItem = {}) {
  const channelState = getMessageChannelState(messageItem);
  const state = normalizeState(channelState?.state || messageItem?.status || messageItem?.state);
  const pending = messageItem?.pending === true;
  const hasFinishedAt = Boolean(getThinkingFinishedAt(messageItem));
  const terminal = isTerminalMessageRuntimeState(state);
  const running = !hasFinishedAt && !terminal && (pending || MESSAGE_RUNNING_CHANNEL_STATES.includes(state));
  const inFlightAssistant = getMessageRole(messageItem) === "assistant" && (
    running || (!hasFinishedAt && !terminal && MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(state))
  );
  const canStopTarget = inFlightAssistant && (
    MESSAGE_CAN_STOP_TARGET_STATES.includes(state) || (pending && !state)
  );
  const messageTiming = resolveRuntimeTimestamp({
    thinkingStartedAt: getThinkingStartedAt(messageItem),
    thinkingFinishedAt: getThinkingFinishedAt(messageItem),
  });
  return {
    state,
    channelState,
    pending,
    running,
    inFlightAssistant,
    canStopTarget,
    startedAt: messageTiming.startedAt || "",
    finishedAt: messageTiming.finishedAt || "",
  };
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
    state: normalizeState(stateItem?.state),
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
      state: BackendChannelState.STOPPED,
      sessionId: trim(stateSnapshot?.sessionId) || trim(channelState?.sessionId),
      dialogProcessId: trim(stateSnapshot?.dialogProcessId) || trim(channelState?.dialogProcessId),
      turnScopeId: trim(stateSnapshot?.turnScopeId) || trim(channelState?.turnScopeId),
      sourceEvent: trim(stateSnapshot?.sourceEvent) || trim(channelState?.sourceEvent) || "stopped",
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
    normalizeState(stateSnapshot?.state) === BackendChannelState.STOPPED &&
    (
      messageItem?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] ||
      resolveSessionRunStateForMessage({
        stateSnapshot: { ...stateSnapshot, state: BackendChannelState.STOPPING },
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
