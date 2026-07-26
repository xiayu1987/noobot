/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";
import { zhCNMessages } from "noobot-i18n/client/locales/zh-CN";
import { enUSMessages } from "noobot-i18n/client/locales/en-US";
import { logResendDebug, summarizeDebugMessage } from "../chat/debug/resendDebugLogger";
import { getMessageTurnScopeId } from "../infra/messageIdentity";
import { storeToRefs } from "pinia";
import { useChatStore } from "../../shared/stores/useChatStore";
import {
  resolveTurnRuntimeByScope,
  turnRuntimeDisplayState,
} from "../chat/sessionRunStateMachine/turnRuntimeRegistry";
import { adaptLegacyMessageTimelines } from "../chat/chatEngine/legacyTimelineAdapter";
import { selectCompletedToolArtifacts } from "../chat/chatEngine/toolTimeline";
import { resolveStatusStepPresentation } from "../infra/messagePresentation";

export function useMessageMeta({
  getMessageItem = () => ({}),
} = {}) {
  const { translate } = useLocale();
  const { turnRuntimeRegistry } = storeToRefs(useChatStore());
  const messageModelLabel = computed(() => {
    const messageItem = getMessageItem() || {};
    const modelRuns = Array.isArray(messageItem?.modelRuns)
      ? messageItem.modelRuns.filter((runLabel) => String(runLabel || "").trim())
      : [];
    if (modelRuns.length) return modelRuns.join(" -> ");
    const modelAlias = String(messageItem?.modelAlias || "").trim();
    const modelName = String(messageItem?.modelName || "").trim();
    if (modelAlias && modelName) return `${modelAlias} (${modelName})`;
    return modelAlias || modelName || "";
  });

  const showSubTaskActivity = computed(() => {
    const messageItem = getMessageItem() || {};
    const realtimeLogs = Array.isArray(messageItem?.realtimeLogs)
      ? messageItem.realtimeLogs
      : [];
    const completedToolResultLogs = selectCompletedToolArtifacts(
      adaptLegacyMessageTimelines(messageItem),
    ).logs;
    return (
      realtimeLogs.some((logItem) => Boolean(logItem?.subAgentCall)) ||
      completedToolResultLogs.some((logItem) => Number(logItem?.depth || 0) > 1)
    );
  });

  const subTaskStatusText = computed(() => {
    const messageItem = getMessageItem() || {};
    const statusLabel = String(messageItem.statusLabel || "").trim();
    const stoppedLabels = new Set([
      String(zhCNMessages?.chat?.stopped || "").trim(),
      String(enUSMessages?.chat?.stopped || "").trim(),
      String(translate("chat.stopped") || "").trim(),
    ]);
    const failedLabels = new Set([
      String(zhCNMessages?.chat?.failed || "").trim(),
      String(enUSMessages?.chat?.failed || "").trim(),
      String(translate("chat.failed") || "").trim(),
    ]);
    const result = messageItem.pending
      ? translate("message.subtaskProcessing")
      : stoppedLabels.has(statusLabel)
        ? translate("message.subtaskStopped")
        : failedLabels.has(statusLabel)
          ? translate("message.subtaskFailed")
          : translate("message.subtaskDone");
    logResendDebug("ui.messageMeta", {
      message: summarizeDebugMessage(messageItem),
      statusLabel,
      subTaskStatusText: result,
    });
    return result;
  });

  const statusStepState = computed(() => {
    const messageItem = getMessageItem() || {};
    const turnScopeId = String(messageItem?.statusTurnScopeId || getMessageTurnScopeId(messageItem)).trim();
    const turnRuntime = resolveTurnRuntimeByScope(turnRuntimeRegistry.value, turnScopeId, {
      sessionId: String(messageItem?.sessionId || messageItem?.session_id || "").trim(),
    });
    return resolveStatusStepPresentation({
      turnRuntime,
      runtimeDisplayState: turnRuntime ? turnRuntimeDisplayState(turnRuntime) : "",
      projectedState: messageItem?.projectedStatusStepState,
      persistedState: messageItem?.persistedStatusStepState,
    }).displayState;
  });

  return {
    messageModelLabel,
    showSubTaskActivity,
    subTaskStatusText,
    statusStepState,
  };
}
