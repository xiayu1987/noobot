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
import { normalizeTimePair, nowMs, toIsoTime } from "../../infra/timeFields";
import {
  BackendChannelState,
  FrontendRunState,
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
  BackendChannelState.COMPLETED,
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
  if (!runTurnScopeId && runDialogProcessId && messageTurnScopeId && messageDialogProcessId) {
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

function resolveRuntimeTimestamp(...values) {
  const normalized = normalizeTimePair({
    createdAt: values[0],
    createdAtMs: values[1],
    updatedAt: values[2],
    updatedAtMs: values[3],
  });
  return {
    startedAt: normalized.createdAt || normalized.createdAtMs || "",
    finishedAt: normalized.updatedAt || normalized.updatedAtMs || "",
  };
}

export function resolveSessionRunMessageRuntimeView(messageItem = {}) {
  const channelState = getMessageChannelState(messageItem);
  const state = normalizeState(channelState?.state || messageItem?.status || messageItem?.state);
  const pending = messageItem?.pending === true;
  const running = pending || MESSAGE_RUNNING_CHANNEL_STATES.includes(state);
  const inFlightAssistant = getMessageRole(messageItem) === "assistant" && (
    pending || MESSAGE_IN_FLIGHT_CHANNEL_STATES.includes(state)
  );
  const canStopTarget = inFlightAssistant && (
    MESSAGE_CAN_STOP_TARGET_STATES.includes(state) || (pending && !state)
  );
  const channelTiming = normalizeTimePair(channelState);
  const messageTiming = resolveRuntimeTimestamp(
    messageItem?.thinkingStartedAt,
    messageItem?.thinkingStartedAtMs,
    messageItem?.thinkingFinishedAt,
    messageItem?.thinkingFinishedAtMs,
  );
  return {
    state,
    channelState,
    pending,
    running,
    inFlightAssistant,
    canStopTarget,
    startedAt: messageTiming.startedAt || channelTiming.createdAt || channelTiming.createdAtMs || "",
    finishedAt: messageTiming.finishedAt || channelTiming.updatedAt || channelTiming.updatedAtMs || "",
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
  if (timing.createdAtMs > 0) channelState.createdAtMs = timing.createdAtMs;
  if (timing.updatedAtMs > 0) channelState.updatedAtMs = timing.updatedAtMs;
  if (timing.createdAt) channelState.createdAt = timing.createdAt;
  if (timing.updatedAt) channelState.updatedAt = timing.updatedAt;
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
  const channelTiming = normalizeTimePair(channelState);
  const finishedAt =
    stateTiming.updatedAt ||
    channelTiming.updatedAt ||
    toIsoTime(nowMs());
  const finishedAtMs =
    stateTiming.updatedAtMs ||
    channelTiming.updatedAtMs ||
    nowMs();
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: FrontendRunState.FRONTEND_COMPLETED,
      updatedAt: finishedAt,
      updatedAtMs: finishedAtMs,
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
  const channelTiming = normalizeTimePair(channelState);
  const finishedAt =
    stateTiming.updatedAt ||
    channelTiming.updatedAt ||
    toIsoTime(nowMs());
  const finishedAtMs =
    stateTiming.updatedAtMs ||
    channelTiming.updatedAtMs ||
    nowMs();
  return {
    clearRuntimeMark: true,
    pending: false,
    channelState: {
      state: BackendChannelState.ERROR,
      updatedAt: finishedAt,
      updatedAtMs: finishedAtMs,
    },
    thinkingFinishedAt: finishedAt,
    thinkingFinishedAtPolicy: "if_missing",
    statusLabelKey: "chat.failed",
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
    return {
      action: SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE,
      reason: SESSION_RUN_MESSAGE_RUNTIME_REASON.IN_FLIGHT_MATCH,
      stateItem,
      patch: buildInFlightMessageRuntimePatch(stateItem),
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
