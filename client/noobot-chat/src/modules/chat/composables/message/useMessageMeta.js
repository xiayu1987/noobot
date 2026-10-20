/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, watch } from "vue";
import { useLocale } from "../../../../shared/i18n/useLocale.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { storeToRefs } from "pinia";
import { useChatStore } from "../../stores/useChatStore.js";
import {
  resolveTurnRuntimeByScope,
  turnRuntimeDisplayState,
} from "../../runtime/run-state-machine/turnRuntimeRegistry.js";
import { selectCompletedToolArtifacts } from "../../runtime/engine/toolTimeline.js";
import {
  MESSAGE_TERMINAL_OUTCOME,
  normalizeTerminalOutcome,
  STATUS_STEP_STAGE,
} from "../../runtime/sessionRunStateMachine.js";
import { resolveStatusStepPresentation } from "../../model/messagePresentation.js";
import { text } from "@noobot/shared/value";

const SUB_TASK_STATUS_TEXT_KEY = Object.freeze({
  [MESSAGE_TERMINAL_OUTCOME.STOPPED]: "message.subtaskStopped",
  [MESSAGE_TERMINAL_OUTCOME.FAILED]: "message.subtaskFailed",
  [MESSAGE_TERMINAL_OUTCOME.GENERATED]: "message.subtaskDone",
});

export function useMessageMeta({ getMessageItem = () => ({}), getRuntimeView = null } = {}) {
  const { translate } = useLocale();
  const { turnRuntimeRegistry } = storeToRefs(useChatStore());
  const messageModelLabel = computed(() => {
    const messageItem = getMessageItem() || {};
    const modelRuns = Array.isArray(messageItem?.modelRuns)
      ? messageItem.modelRuns.filter((runLabel) => text(runLabel))
      : [];
    if (modelRuns.length) return modelRuns.join(" -> ");
    const modelAlias = text(messageItem?.modelAlias);
    const modelName = text(messageItem?.modelName);
    if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
    return modelAlias || modelName || "";
  });

  const showSubTaskActivity = computed(() => {
    const messageItem = getMessageItem() || {};
    const completedToolResultLogs = selectCompletedToolArtifacts(messageItem).logs;
    return completedToolResultLogs.some((logItem) => Number(logItem?.depth || 0) > 1);
  });

  const subTaskStatusText = computed(() => {
    const messageItem = getMessageItem() || {};
    if (messageItem.pending) return translate("message.subtaskProcessing");
    const terminalOutcome = normalizeTerminalOutcome(messageItem.terminalOutcome);
    return translate(SUB_TASK_STATUS_TEXT_KEY[terminalOutcome] || "message.subtaskDone");
  });

  const subTaskStatusSignature = computed(() => {
    const messageItem = getMessageItem() || {};
    return [
      messageItem.messageId || "",
      messageItem.pending === true ? "pending" : "settled",
      normalizeTerminalOutcome(messageItem.terminalOutcome),
      subTaskStatusText.value,
    ].join("|");
  });

  watch(
    subTaskStatusSignature,
    () =>
      logResendDebug("ui.messageMeta", () => {
        const messageItem = getMessageItem() || {};
        return {
          message: summarizeDebugMessage(messageItem),
          terminalOutcome: normalizeTerminalOutcome(messageItem.terminalOutcome),
          subTaskStatusText: subTaskStatusText.value,
        };
      }),
    { immediate: true, flush: "post" },
  );

  const statusStepState = computed(() => {
    const messageItem = getMessageItem() || {};
    const turnScopeId = text(messageItem?.statusTurnScopeId) || getMessageTurnScopeId(messageItem);
    const turnRuntime = resolveTurnRuntimeByScope(turnRuntimeRegistry.value, turnScopeId, {
      sessionId: text(messageItem?.sessionId),
    });
    const projectedRuntime =
      typeof getRuntimeView === "function" ? getRuntimeView(messageItem) : null;
    if (projectedRuntime && projectedRuntime.running === true && !projectedRuntime.terminal) {
      return (
        resolveStatusStepPresentation({
          turnRuntime: projectedRuntime,
          runtimeDisplayState: projectedRuntime.displayState,
          projectedState: messageItem?.projectedStatusStepState,
        }).displayState || STATUS_STEP_STAGE.SENDING
      );
    }
    return resolveStatusStepPresentation({
      turnRuntime,
      runtimeDisplayState: turnRuntime ? turnRuntimeDisplayState(turnRuntime) : "",
      projectedState: messageItem?.projectedStatusStepState,
    }).displayState;
  });

  return {
    messageModelLabel,
    showSubTaskActivity,
    subTaskStatusText,
    statusStepState,
  };
}
