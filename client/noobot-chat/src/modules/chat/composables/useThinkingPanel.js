/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { useLocale } from "../../../shared/i18n/useLocale.js";
import { useThinkingTimeline } from "./thinkingPanelTimeline.js";
import { createThinkingPanelPresentation } from "./thinkingPanelPresentation.js";
import { useThinkingRuntime } from "./thinkingPanelRuntime.js";

export function useThinkingPanel(props, emit, { shouldLoadThinkingDetail = () => true } = {}) {
  const { translate } = useLocale();
  const getRuntimeView = () =>
    props.runtime || { running: false, terminal: false, startedAt: "", finishedAt: "" };

  const timeline = useThinkingTimeline(props, translate, getRuntimeView, { shouldLoadThinkingDetail });
  const runtime = useThinkingRuntime(props, getRuntimeView);
  const presentation = createThinkingPanelPresentation({
    props,
    emit,
    translate,
    getThinkingDetailForMessage: timeline.getThinkingDetailForMessage,
    getCanonicalExecutionLogs: timeline.getCanonicalExecutionLogs,
  });

  return {
    thinkingContentItems: timeline.thinkingContentItems,
    hasThinking: timeline.hasThinking,
    translate,
    getThinkingDurationLabel: runtime.getThinkingDurationLabel,
    isThinkingRuntimeRunning: runtime.isThinkingRuntimeRunning,
    getLatestPluginAnalysisLog: timeline.getLatestPluginAnalysisLog,
    getLatestMainModelContentLog: timeline.getLatestMainModelContentLog,
    getExecutionLogs: timeline.getExecutionLogs,
    getCanonicalExecutionLogs: timeline.getCanonicalExecutionLogs,
    currentExecutionLogs: timeline.currentExecutionLogs,
    latestTaskCheckReceipt: timeline.latestTaskCheckReceipt,
    taskCheckReceipts: timeline.taskCheckReceipts,
    loadedThinkingDetail: timeline.loadedThinkingDetail,
    getExecutionLogCount: timeline.getExecutionLogCount,
    getThinkingDetailLabel: presentation.getThinkingDetailLabel,
    openThinkingDetailDrawer: presentation.openThinkingDetailDrawer,
    collapseThinkingPanel: presentation.collapseThinkingPanel,
    isMessageRuntimeRunning: timeline.isMessageRuntimeRunning,
    groupExecutionLogs: presentation.groupExecutionLogs,
    getThinkingDetailCount: presentation.getThinkingDetailCount,
    getThinkingTreePrefix: presentation.getThinkingTreePrefix,
    getThinkingDetailItemKey: presentation.getThinkingDetailItemKey,
    isThinkingDetailExpanded: presentation.isThinkingDetailExpanded,
    toggleThinkingDetailExpanded: presentation.toggleThinkingDetailExpanded,
  };
}
