/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  resolveSessionRunMessageRuntimePatch,
  SESSION_RUN_MESSAGE_RUNTIME_ACTION,
  SESSION_RUN_MESSAGE_RUNTIME_MARK,
} from "../sessionRunStateMachine";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../debug/stateMachineLogger";
import { getMessageTurnScopeId } from "../../infra/messageIdentity";
import { getMessageDialogProcessId } from "../../infra/messageIdentity";
import { selectTurnMessageRuntime, sessionRuntimeId } from "../sessionRunStateMachine/turnRuntimeRegistry";

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
      if (!message.statusLabelKey && !message.statusLabel) message.statusLabelKey = value;
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
  const session = sessionItems.find((item) => sessionRuntimeId(item) === stateSnapshot.sessionId);
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!messages.length) return;
  messages.forEach((message) => {
    const messageTurnScopeId = getMessageTurnScopeId(message);
    const messageDialogProcessId = getMessageDialogProcessId(message);
    const sameTurn = stateSnapshot.turnScopeId && messageTurnScopeId === stateSnapshot.turnScopeId;
    const sameDialog = stateSnapshot.dialogProcessId && messageDialogProcessId === stateSnapshot.dialogProcessId;
    if (!sameTurn && !sameDialog) return;
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
      const existingTiming = session.turnTimingsByTurnScopeId?.[turnScopeId] || {};
      session.turnTimingsByTurnScopeId = {
        ...(session.turnTimingsByTurnScopeId || {}),
        [turnScopeId]: {
          ...existingTiming,
          ...(timingPatch.thinkingStartedAt && !existingTiming.thinkingStartedAt
            ? { thinkingStartedAt: timingPatch.thinkingStartedAt }
            : {}),
          ...(timingPatch.thinkingFinishedAt && !existingTiming.thinkingFinishedAt
            ? { thinkingFinishedAt: timingPatch.thinkingFinishedAt }
            : {}),
        },
      };
    }
    applyRunStateMessagePatch(message, effect.patch);
  });
}
