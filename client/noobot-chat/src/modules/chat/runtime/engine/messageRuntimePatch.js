/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_RUN_MESSAGE_RUNTIME_MARK } from "../sessionRunStateMachine.js";
import {
  logStateMachineDebug,
  summarizeStateMachineMessage,
} from "../../../debug/loggers/stateMachineLogger.js";

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
  logStateMachineDebug("stateMachine.messageRuntimePatch.apply", () => ({
    message: summarizeStateMachineMessage(message),
    pending: message?.pending === true,
    channelState: message?.channelState?.state || "",
    hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
    clearRuntimeMark: clearRuntimeMark === true,
    patchChannelState: patch?.channelState?.state || "",
    patchPending: patch?.pending,
    statusLabelKey: patch?.statusLabelKey || "",
  }));
}

export function summarizeMessageRuntimeProjection({ message, stateSnapshot, effect } = {}) {
  logStateMachineDebug("stateMachine.messageRuntimePatch.effect", () => ({
    runState: stateSnapshot?.state || "",
    eventType: stateSnapshot?.sourceEvent || "",
    message: summarizeStateMachineMessage(message),
    hasRuntimeMark: Boolean(message?.[SESSION_RUN_MESSAGE_RUNTIME_MARK] || message?.runtimeMark),
    effectAction: effect?.action || "",
    effectReason: effect?.reason || "",
    patchChannelState: "",
    clearRuntimeMark: effect?.patch?.clearRuntimeMark === true,
  }));
}
