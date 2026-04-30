/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { useLocale } from "../../shared/i18n/useLocale";

export function useMessageMeta({ getMessageItem = () => ({}) } = {}) {
  const { t } = useLocale();
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
    const completedToolLogs = Array.isArray(messageItem?.completedToolLogs)
      ? messageItem.completedToolLogs
      : [];
    return (
      realtimeLogs.some((logItem) => Boolean(logItem?.subAgentCall)) ||
      completedToolLogs.some((logItem) => Number(logItem?.depth || 0) > 1)
    );
  });

  const subTaskStatusText = computed(() => {
    const messageItem = getMessageItem() || {};
    const statusLabel = String(messageItem.statusLabel || "").trim();
    if (messageItem.pending) return t("message.subtaskProcessing");
    if (statusLabel === t("chat.stopped") || statusLabel === "已停止" || statusLabel === "Stopped") return t("message.subtaskStopped");
    if (statusLabel === t("chat.failed") || statusLabel === "生成失败" || statusLabel === "Generation failed") return t("message.subtaskFailed");
    return t("message.subtaskDone");
  });

  return {
    messageModelLabel,
    showSubTaskActivity,
    subTaskStatusText,
  };
}
