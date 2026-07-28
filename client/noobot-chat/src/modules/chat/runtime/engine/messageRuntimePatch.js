/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveSessionRunMessageRuntimePatch,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../sessionRunStateMachine.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";
import { mergeCanonicalTurnTiming } from "../run-state-machine/turnTiming.js";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { getMessageDialogProcessId } from "../../model/messageIdentity.js";
import { selectTurnMessageRuntime, sessionRuntimeId } from "../run-state-machine/turnRuntimeRegistry.js";

export function applyRunStateMessagePatch(message, patch = {}) {
  if (!message || !patch || typeof patch !== "object") return;
  const {
    clearRuntimeMark,
    statusLabelPolicy,
    ...restPatch
  } = patch;

  Object.entries(restPatch).forEach(([key, value]) => {
    if (key === "thinkingStartedAt" || key === "thinkingFinishedAt") return;
    if (key === "statusLabelKey" && statusLabelPolicy === "if_empty") {
      if (!message.statusLabelKey && !message.statusLabel) {
        message.statusLabelKey = value;
        message.statusLabel = value;
      }
      return;
    }
    if (key === "statusLabelKey") {
      message.statusLabelKey = value;
      message.statusLabel = value;
      return;
    }
    if (key === "channelState" && value && typeof value === "object" && !Array.isArray(value)) {
      message.channelState = {
        ...(message.channelState && typeof message.channelState === "object" && !Array.isArray(message.channelState)
          ? message.channelState
          : {}),
        ...value,
      };
      return;
    }
    message[key] = value;
  });

  if (clearRuntimeMark) {
    delete message[SESSION_RUN_MESSAGE_RUNTIME_MARK];
    delete message.runtimeMark;
  }
  logStateMachineDebug("stateMachine.messageRuntimePatch.apply", {
    message: summarizeStateMachineMessage(message),
    pending: message?.pending === true,
    channelState: message?.channelState?.state || "",
    hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
    clearRuntimeMark: clearRuntimeMark === true,
    patchChannelState: patch?.channelState?.state || "",
    patchPending: patch?.pending,
    statusLabelKey: patch?.statusLabelKey || "",
  });
}

export function applyRunStateMessageRuntimePatch({
  sessions,
  activeSession,
  turnRuntimeRegistry,
  event,
} = {}) {
  const registry = turnRuntimeRegistry?.value || turnRuntimeRegistry;
  const stateSnapshot = selectTurnMessageRuntime(registry, {
    sessionId: event?.sessionId,
    turnScopeId: event?.turnScopeId,
    dialogProcessId: event?.dialogProcessId,
  });
  if (!stateSnapshot) return;
  const sessionItems = Array.isArray(sessions?.value) ? sessions.value : Array.isArray(sessions) ? sessions : [];
  const activeSessionValue = activeSession?.value || activeSession;
  const session = sessionItems.find((item) => sessionRuntimeId(item) === stateSnapshot.sessionId)
    || ([activeSessionValue?.id, activeSessionValue?.backendSessionId]
      .map(sessionRuntimeId)
      .includes(stateSnapshot.sessionId)
      ? activeSessionValue
      : null);
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!messages.length) return;
  messages.forEach((message) => {
    const messageTurnScopeId = getMessageTurnScopeId(message);
    const messageDialogProcessId = getMessageDialogProcessId(message);
    const sameTurn = stateSnapshot.turnScopeId && messageTurnScopeId === stateSnapshot.turnScopeId;
    const sameDialog = stateSnapshot.dialogProcessId && messageDialogProcessId === stateSnapshot.dialogProcessId;
    if (stateSnapshot.turnScopeId ? !sameTurn : !sameDialog) return;
    const effect = resolveSessionRunMessageRuntimePatch({
      stateSnapshot,
      messageItem: message,
      activeSession: session,
    });
    logStateMachineDebug("stateMachine.messageRuntimePatch.effect", {
      runState: stateSnapshot.state || "",
      eventType: stateSnapshot.sourceEvent || "",
      message: summarizeStateMachineMessage(message),
      hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
      effectAction: effect?.action || "",
      effectReason: effect?.reason || "",
      patchChannelState: effect?.patch?.channelState?.state || "",
      clearRuntimeMark: effect?.patch?.clearRuntimeMark === true,
    });
    if (effect?.action !== SESSION_RUN_MESSAGE_RUNTIME_ACTION.PATCH_MESSAGE) return;
    const turnScopeId = getMessageTurnScopeId(message);
    const timingPatch = effect.patch || {};
    if (turnScopeId && (timingPatch.thinkingStartedAt || timingPatch.thinkingFinishedAt)) {
      const canonicalTiming = mergeCanonicalTurnTiming(session, turnScopeId);
      const existingTiming = canonicalTiming;
      const projectedTiming = {};
      if (existingTiming.thinkingStartedAt) {
        projectedTiming.thinkingStartedAt = existingTiming.thinkingStartedAt;
      }
      if (existingTiming.thinkingFinishedAt) {
        projectedTiming.thinkingFinishedAt = existingTiming.thinkingFinishedAt;
      }
      if (timingPatch.thinkingStartedAt && !projectedTiming.thinkingStartedAt) {
        projectedTiming.thinkingStartedAt = timingPatch.thinkingStartedAt;
      }
      if (timingPatch.thinkingFinishedAt && !projectedTiming.thinkingFinishedAt) {
        projectedTiming.thinkingFinishedAt =
          projectedTiming.thinkingStartedAt || timingPatch.thinkingStartedAt || timingPatch.thinkingFinishedAt;
      }
      session.turnTimingsByTurnScopeId = {
        ...(session.turnTimingsByTurnScopeId || {}),
        [turnScopeId]: {
          ...projectedTiming,
        },
      };
    }
    applyRunStateMessagePatch(message, effect.patch);
  });
}
