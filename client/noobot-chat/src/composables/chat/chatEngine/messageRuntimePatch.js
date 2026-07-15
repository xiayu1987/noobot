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
  activeSession,
  runStateSnapshot,
} = {}) {
  const session = activeSession?.value;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  if (!messages.length) return;
  messages.forEach((message) => {
    const effect = resolveSessionRunMessageRuntimePatch({
      stateSnapshot: runStateSnapshot?.value,
      messageItem: message,
      activeSession: session,
    });
    logStateMachineDebug("stateMachine.messageRuntimePatch.effect", {
      runState: runStateSnapshot?.value?.state || "",
      eventType: runStateSnapshot?.value?.sourceEvent || "",
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
