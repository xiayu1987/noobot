/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, ref, watch } from "vue";
import {
  formatDurationMs,
  nowMs,
  resolveThinkingDurationMs,
  resolveTimeMs,
} from "../model/timeFields.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
} from "../model/messageIdentity.js";
import { logReconnectTimingDebug } from "../../debug/loggers/reconnectTimingDebugLogger.js";
import { logThinkingReplayDebug } from "../../debug/loggers/thinkingReplayDebugLogger.js";
import { setTurnThinkingOpenNames } from "../runtime/engine/turnUiStore.js";

export function useThinkingRuntime(props, getRuntimeView) {
  const nowTick = ref(nowMs());
  let timer = null;
  let lastRenderRuntimeSignature = "";
  function getThinkingDurationLabel() {
    const durationMs = getThinkingDurationMs(props.messageItem);
    return durationMs === null ? "--:--" : formatDurationMs(durationMs);
  }
  function parseAnyTimeMs(...values) {
    return resolveTimeMs(...values);
  }

  function getThinkingDurationMs(messageItem = {}) {
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const runtimeView = getRuntimeView(messageItem);
    const startedAt = parseAnyTimeMs(runtimeView.startedAt);
    const finishedAt = parseAnyTimeMs(runtimeView.finishedAt);
    const durationMs = resolveThinkingDurationMs({
      messageStartedAt: startedAt,
      messageFinishedAt: finishedAt,
      now: nowTick.value,
      running: runtimeView.running,
    });
    logReconnectTimingDebug("frontend.reconnectTiming.durationResolved", {
      sessionId: getMessageSessionId(messageItem),
      dialogProcessId: getMessageDialogProcessId(messageItem),
      turnScopeId,
      messageRole: getMessageRole(messageItem),
      messagePending: messageItem?.pending === true,
      runtimeState: runtimeView.state,
      running: runtimeView.running,
      timingFound: Boolean(runtimeView.startedAt || runtimeView.finishedAt),
      thinkingStartedAt: runtimeView.startedAt || "",
      thinkingFinishedAt: runtimeView.finishedAt || "",
      startedAtMs: startedAt,
      finishedAtMs: finishedAt,
      nowMs: nowTick.value,
      durationMs,
    });
    return durationMs;
  }

  function isThinkingRuntimeRunning(messageItem = {}) {
    return getRuntimeView(messageItem).running;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      nowTick.value = nowMs();
    }, 1000);
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  watch(
    () => isThinkingRuntimeRunning(props.messageItem),
    (running) => {
      if (running) {
        startTimer();
        setTurnThinkingOpenNames(props.messageItem, ["thinking-panel"]);
      } else {
        stopTimer();
        const runtime = getRuntimeView(props.messageItem);
        if (runtime.terminal) setTurnThinkingOpenNames(props.messageItem, []);
      }
    },
    { immediate: true },
  );

  watch(
    () => {
      const runtime = getRuntimeView(props.messageItem);
      return [
        getMessageSessionId(props.messageItem),
        getMessageDialogProcessId(props.messageItem),
        getMessageTurnScopeId(props.messageItem),
        runtime.state || "",
        runtime.running === true,
        runtime.terminal || "",
        runtime.startedAt || "",
        runtime.finishedAt || "",
      ].join("|");
    },
    (signature) => {
      if (!signature || signature === lastRenderRuntimeSignature) return;
      lastRenderRuntimeSignature = signature;
      const runtime = getRuntimeView(props.messageItem);
      logThinkingReplayDebug("frontend.render.thinkingRuntimeConsumed", {
        sessionId: getMessageSessionId(props.messageItem),
        dialogProcessId: getMessageDialogProcessId(props.messageItem),
        turnScopeId: getMessageTurnScopeId(props.messageItem),
        runtimeState: runtime.state || "",
        running: runtime.running === true,
        terminal: runtime.terminal || null,
        startedAt: runtime.startedAt || "",
        finishedAt: runtime.finishedAt || "",
        pending: props.messageItem?.pending === true,
        messageRole: getMessageRole(props.messageItem),
      });
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopTimer();
  });

  return {
    getThinkingDurationLabel,
    isThinkingRuntimeRunning,
  };
}
