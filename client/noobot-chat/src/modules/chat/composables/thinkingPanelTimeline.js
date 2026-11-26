/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onWatcherCleanup, ref, watch } from "vue";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../model/messageIdentity.js";
import { projectExecutionLogDisplay } from "../runtime/engine/utils.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { logThinkingReplayDebug } from "../../debug/loggers/thinkingReplayDebugLogger.js";
import { logStateMachineDebug } from "../../debug/loggers/stateMachineLogger.js";
import {
  logToolLogWindowDebug,
  summarizeToolLogWindow,
} from "../../debug/loggers/toolLogWindowDebugLogger.js";
import { normalizeThinkingToolLogs } from "../model/thinkingDetailModel.js";
import { resolveThinkingDetailIdentity } from "../model/thinkingDetailRequest.js";
import {
  selectToolTimelineCount,
  selectToolTimelineLogs,
  mergeToolTimelines,
  selectLatestTaskCheckReceipt,
  selectTaskCheckReceipts,
} from "../runtime/engine/toolTimeline.js";
import {
  selectActivityTimelineLogs,
  selectLatestAnalysisActivities,
} from "../runtime/engine/activityTimeline.js";
import {
  mergeCanonicalActivityTimelines,
  selectMessageActivityTimeline,
} from "@noobot/event-protocol/activity-timeline";
import {
  countCanonicalToolTimelineEvents,
  selectMessageToolTimeline,
} from "@noobot/event-protocol/tool-timeline";
import {
  createThinkingAnalysisProjection,
  sourceToProjectionLatencyMs,
} from "./thinkingPanelAnalysis.js";
import { selectThinkingDetailCount } from "../model/thinkingDetailCount.js";
import {
  projectThinkingDetailContentTimeline,
  reduceThinkingDetailContentTimelines,
  selectThinkingDetailContentTimeline,
} from "@noobot/event-protocol/thinking-detail-content";
import { thinkingDetailService } from "../../../infrastructure/api/thinking/thinkingDetailService.js";
import { useThinkingDetailPagination } from "./thinkingDetailPagination.js";

export function useThinkingTimeline(
  props,
  getRuntimeView,
  { shouldLoadThinkingDetail = () => true } = {},
) {
  const roundMessages = computed((previous) => {
    const messageItem = props.messageItem || {};
    const sessionId = getMessageSessionId(messageItem);
    const turnScopeId = getMessageTurnScopeId(messageItem);
    if (!turnScopeId || !Array.isArray(props.allMessages)) return [];
    const members = props.allMessages.filter(
      (candidate) =>
        getMessageSessionId(candidate) === sessionId &&
        getMessageTurnScopeId(candidate) === turnScopeId,
    );
    return previous?.length === members.length &&
      members.every((member, index) => member === previous[index])
      ? previous
      : members;
  });
  const roundToolTimeline = computed(() =>
    mergeToolTimelines(
      ...roundMessages.value.map((candidate) =>
        Array.isArray(candidate?.toolTimeline) ? candidate.toolTimeline : [],
      ),
    ),
  );
  const roundActivityTimeline = computed(() =>
    mergeCanonicalActivityTimelines(...roundMessages.value.map(selectMessageActivityTimeline)),
  );
  const roundThinkingContentTimeline = computed(() =>
    projectThinkingDetailContentTimeline(roundMessages.value, roundActivityTimeline.value),
  );
  const roundTimelineFacets = Object.freeze({
    get toolTimeline() {
      return roundToolTimeline.value;
    },
    get activityTimeline() {
      return roundActivityTimeline.value;
    },
    get thinkingContentTimeline() {
      return roundThinkingContentTimeline.value;
    },
  });
  const isMultiMessageRound = computed(() => roundMessages.value.length > 1);

  function timelineMessage(messageItem = {}) {
    if (messageItem !== props.messageItem) return messageItem;
    if (props.variant === "details" && loadedThinkingDetail.value)
      return loadedThinkingDetail.value.messageItem;
    return isMultiMessageRound.value ? roundTimelineFacets : messageItem;
  }
  const loadedThinkingDetail = ref(null);
  const detailPagination = useThinkingDetailPagination({
    identity: () =>
      resolveThinkingDetailIdentity(props.messageItem, getMessageSessionId(props.messageItem)),
    detail: loadedThinkingDetail,
    getReader: () => {
      if (props.fetchThinkingDetail === undefined || props.fetchThinkingDetail === null) {
        const userId = props.userId;
        return {
          fetchPage: (target) => thinkingDetailService.getPage({ userId, ...target }),
          releasePage: (target) => thinkingDetailService.release({ userId, ...target }),
        };
      }
      if (typeof props.releaseThinkingDetail !== "function")
        throw new TypeError("Injected thinking detail reader requires releaseThinkingDetail");
      const userId = props.userId;
      const fetchPage = props.fetchThinkingDetail;
      const releasePage = props.releaseThinkingDetail;
      return {
        fetchPage: (target) => fetchPage({ ...target, userId }),
        releasePage: (target) => releasePage({ ...target, userId }),
      };
    },
  });
  const thinkingDetailLoadingKey = computed(() =>
    detailPagination.loading.value ? thinkingDetailLoadKey.value : "",
  );
  function selectActivityMessage(messageItem = props.messageItem) {
    const current = timelineMessage(messageItem);
    if (selectActivityTimelineLogs(current).length > 0) return current;
    return timelineMessage(loadedThinkingDetail.value?.messageItem || current);
  }
  const thinkingContentItems = computed(() =>
    reduceThinkingDetailContentTimelines(
      selectThinkingDetailContentTimeline(
        timelineMessage(loadedThinkingDetail.value?.messageItem || {}),
      ),
      selectThinkingDetailContentTimeline(timelineMessage(props.messageItem)),
    ).map((item = {}) => ({
      ...item,
      content: item.text,
    })),
  );
  const hasThinking = computed(() => {
    const detailMessageItem = loadedThinkingDetail.value?.messageItem;
    return hasThinkingLogs(detailMessageItem || props.messageItem);
  });
  const EXECUTION_LOG_DISPLAY_LIMIT = QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

  function thinkingReplayScope(messageItem = props.messageItem || {}) {
    return {
      sessionId: getMessageSessionId(messageItem),
      dialogProcessId: getMessageDialogProcessId(messageItem),
      turnScopeId: getMessageTurnScopeId(messageItem),
    };
  }

  function summarizeThinkingMessage(messageItem = {}) {
    const allRealtimeLogs = getAllRealtimeLogs(messageItem);
    const visibleRealtimeLogs = getRealtimeLogs(messageItem);
    return {
      role: getMessageRole(messageItem),
      pending: messageItem?.pending === true,
      hasThinkingDetails: messageItem?.hasThinkingDetails === true,
      thinkingDetailCount: selectThinkingDetailCount(messageItem),
      realtimeLogCount: allRealtimeLogs.length,
      visibleRealtimeLogCount: visibleRealtimeLogs.length,
      realtimeLogProjection: allRealtimeLogs.slice(-10).map(summarizeRealtimeLog),
      completedToolLogCount: selectToolTimelineCount(timelineMessage(messageItem)),
    };
  }

  function summarizeRealtimeLog(logItem = {}) {
    const inputText = String(logItem?.text || "");
    return {
      event: String(logItem?.event || ""),
      type: String(logItem?.type || ""),
      category: String(logItem?.category || ""),
      sequence: logItem?.sequence ?? null,
      textLength: inputText.length,
      textPreview: inputText.slice(0, 240),
    };
  }

  function getRealtimeLogs(messageItem = {}) {
    if (messageItem === props.messageItem) {
      return currentExecutionTimelineProjection.value.visibleLogs;
    }
    return getAllRealtimeLogs(messageItem);
  }

  function getAllRealtimeLogs(messageItem = {}) {
    if (messageItem === props.messageItem) {
      return currentExecutionTimelineProjection.value.allLogs;
    }
    return buildExecutionTimelineProjection(messageItem).allLogs;
  }

  function projectExecutionTimeline(toolLogs = []) {
    const allLogs = toolLogs.map(projectExecutionLogDisplay);
    return {
      toolLogs,
      allLogs,
      visibleLogs: allLogs,
    };
  }

  function buildExecutionTimelineProjection(messageItem = {}) {
    const canonicalMessage = timelineMessage(messageItem);
    return projectExecutionTimeline(selectToolTimelineLogs(canonicalMessage));
  }

  const currentAnalysisProjection = computed(() =>
    selectLatestAnalysisActivities(selectActivityMessage()),
  );
  const currentToolTimelineLogs = computed(() => {
    const current = timelineMessage(props.messageItem);
    if (props.variant === "details")
      return selectToolTimelineLogs(current, { includeDetail: false }).filter(
        (log) => log.detailValue !== undefined,
      );
    const detail = loadedThinkingDetail.value?.messageItem;
    const message = detail
      ? {
          toolTimeline: mergeToolTimelines(
            selectMessageToolTimeline(current),
            selectMessageToolTimeline(detail),
          ),
        }
      : current;
    return selectToolTimelineLogs(message).slice(-EXECUTION_LOG_DISPLAY_LIMIT);
  });
  const currentExecutionTimelineProjection = computed(() =>
    projectExecutionTimeline(currentToolTimelineLogs.value),
  );

  function getCanonicalExecutionLogs(messageItem = {}) {
    const projection =
      messageItem === props.messageItem
        ? currentExecutionTimelineProjection.value
        : buildExecutionTimelineProjection(messageItem);
    if (projection.visibleLogs.length > 0) return projection.visibleLogs;
    if (messageItem === props.messageItem) {
      const detailMessage = loadedThinkingDetail.value?.messageItem;
      if (detailMessage) {
        const detailProjection = buildExecutionTimelineProjection(detailMessage);
        if (detailProjection.visibleLogs.length > 0) return detailProjection.visibleLogs;
      }
    }
    return [];
  }

  function getExecutionLogs(messageItem = {}) {
    return getCanonicalExecutionLogs(messageItem);
  }

  function getAllCompletedLogs(messageItem = {}) {
    const loadedDetail = getThinkingDetailForMessage(messageItem);
    const detailMessageItem = loadedDetail?.messageItem || messageItem;
    if (
      isAssistantWithoutTurnScope(detailMessageItem) &&
      String(props.variant || "panel") !== "details"
    )
      return [];
    const normalized = normalizeThinkingToolLogs({
      messageItem: detailMessageItem,
    });
    return normalized;
  }

  function getExecutionLogCount(messageItem = {}) {
    const currentCount = countCanonicalToolTimelineEvents(
      selectMessageToolTimeline(timelineMessage(messageItem)),
    );
    if (currentCount > 0 || messageItem !== props.messageItem) return currentCount;
    return countCanonicalToolTimelineEvents(
      selectMessageToolTimeline(timelineMessage(loadedThinkingDetail.value?.messageItem || {})),
    );
  }

  function hasSummaryThinkingDetails(messageItem = {}) {
    return messageItem?.hasThinkingDetails === true || selectThinkingDetailCount(messageItem) > 0;
  }

  function getThinkingDetailCount(messageItem = {}) {
    const count = selectThinkingDetailCount(timelineMessage(messageItem));
    if (count > 0 || messageItem !== props.messageItem) return count;
    return selectThinkingDetailCount(loadedThinkingDetail.value?.messageItem);
  }

  function getThinkingDetailForMessage(messageItem = {}) {
    if (
      selectToolTimelineCount(timelineMessage(messageItem)) > 0 ||
      selectActivityTimelineLogs(timelineMessage(messageItem)).length > 0 ||
      selectThinkingDetailContentTimeline(timelineMessage(messageItem)).length > 0
    )
      return null;
    const loaded = loadedThinkingDetail.value;
    const identity = resolveThinkingDetailIdentity(messageItem, getMessageSessionId(messageItem));
    if (identity === null) return null;
    if (loaded?.__thinkingDetailIdentity?.key === identity.key) return loaded;
    return null;
  }

  const currentExecutionLogs = computed(() =>
    getCanonicalExecutionLogs(props.messageItem).slice(-EXECUTION_LOG_DISPLAY_LIMIT),
  );
  const latestTaskCheckReceipt = computed(() => {
    const liveReceipt = selectLatestTaskCheckReceipt(timelineMessage(props.messageItem));
    if (liveReceipt) return liveReceipt;
    return selectLatestTaskCheckReceipt(
      timelineMessage(loadedThinkingDetail.value?.messageItem || {}),
    );
  });
  const taskCheckReceipts = computed(() => {
    const liveReceipts = selectTaskCheckReceipts(timelineMessage(props.messageItem));
    if (liveReceipts.length > 0) return liveReceipts;
    return selectTaskCheckReceipts(timelineMessage(loadedThinkingDetail.value?.messageItem || {}));
  });

  const { getLatestModelAnalysisLog, getAnalysisActivityTimeline, summarizeAnalysisProjection } =
    createThinkingAnalysisProjection({
      props,
      currentAnalysisProjection,
      timelineMessage,
    });

  watch(
    () => {
      const timeline = currentExecutionTimelineProjection.value;
      const lastCandidate = timeline.allLogs.at(-1) || {};
      const lastVisible = currentExecutionLogs.value.at(-1) || {};
      const analysis = summarizeAnalysisProjection(props.messageItem);
      return [
        getMessageSessionId(props.messageItem),
        getMessageDialogProcessId(props.messageItem),
        getMessageTurnScopeId(props.messageItem),
        getRuntimeView(props.messageItem).running === true,
        props.messageItem?.pending === true,
        timeline.allLogs.length,
        lastCandidate.eventId || "",
        lastCandidate.sequence ?? "",
        currentExecutionLogs.value.length,
        lastVisible.eventId || "",
        lastVisible.sequence ?? "",
        analysis.activityTimelineCount,
        analysis.latestModelAnalysisEventId,
        analysis.latestModelAnalysisOutputLength,
      ].join("|");
    },
    () => {
      const identity = thinkingReplayScope(props.messageItem);
      const running = getRuntimeView(props.messageItem).running === true;
      const pending = props.messageItem?.pending === true;
      const timeline = currentExecutionTimelineProjection.value;
      const selectedLogs = currentExecutionLogs.value;
      const source = timeline.visibleLogs.length > 0 ? "live" : "detail-fallback";
      const analysis = summarizeAnalysisProjection(props.messageItem);
      const projectedAtMs = Date.now();
      const projectedAt = new Date(projectedAtMs).toISOString();
      logThinkingReplayDebug("frontend.thinkingReplay.displayProjectionChanged", () => ({
        ...identity,
        running,
        pending,
        source,
        visibleLogCount: selectedLogs.length,
        visibleLogs: selectedLogs.slice(-10).map(summarizeRealtimeLog),
        ...analysis,
        projectedAt,
        modelAnalysisSourceToProjectionLatencyMs: sourceToProjectionLatencyMs(
          analysis.latestModelAnalysisTimestamp,
          projectedAtMs,
        ),
      }));
      logToolLogWindowDebug("frontend.toolLogWindow.executionWindowSelected", () => ({
        ...identity,
        running,
        pending,
        source,
        displayLimit: EXECUTION_LOG_DISPLAY_LIMIT,
        activityTimelineCount: selectActivityTimelineLogs(timelineMessage(props.messageItem))
          .length,
        toolTimelineEntryCount: timeline.toolLogs.length,
        candidateCount: timeline.allLogs.length,
        candidates: summarizeToolLogWindow(timeline.allLogs.slice(-EXECUTION_LOG_DISPLAY_LIMIT)),
        selectedCount: selectedLogs.length,
        selected: summarizeToolLogWindow(selectedLogs),
      }));
      logStateMachineDebug("frontend.thinkingReplay.timelineProjected", () => ({
        ...identity,
        presentationMessageId: String(props.messageItem?.presentationMessageId || ""),
        running,
        pending,
        source,
        activityTimelineCount: selectActivityTimelineLogs(timelineMessage(props.messageItem))
          .length,
        toolTimelineLogCount: timeline.toolLogs.length,
        selectedCount: selectedLogs.length,
        selected: summarizeToolLogWindow(selectedLogs),
      }));
    },
    { immediate: true },
  );

  const thinkingDetailLoadKey = computed(() => {
    const messageItem = props.messageItem || {};
    if (shouldLoadThinkingDetail() !== true) return "";
    if (messageItem?.pending === true) return "";
    const identity = resolveThinkingDetailIdentity(messageItem, getMessageSessionId(messageItem));
    return identity === null ? "" : identity.key;
  });

  watch(
    [
      thinkingDetailLoadKey,
      () => props.userId,
      () => props.fetchThinkingDetail,
      () => props.releaseThinkingDetail,
    ],
    async ([key]) => {
      let cancelled = false;
      onWatcherCleanup(() => {
        cancelled = true;
      });
      const released = detailPagination.invalidate();
      loadedThinkingDetail.value = null;
      try {
        await released;
      } catch (cause) {
        detailPagination.error.value = cause;
        return;
      }
      if (!key || cancelled) return;
      await detailPagination.restart();
    },
    { immediate: true, flush: "sync" },
  );

  function hasThinkingLogs(messageItem = {}) {
    const runtime = getRuntimeView(messageItem);
    let result = false;
    let reason = "no-logs";
    if (!messageItem || getMessageRole(messageItem) !== "assistant") {
      reason = "not-assistant";
    } else if (runtime.running) {
      result = true;
      reason = "runtime-running";
    } else if (hasSummaryThinkingDetails(messageItem)) {
      result = true;
      reason = "summary";
    } else if (selectThinkingDetailContentTimeline(timelineMessage(messageItem)).length > 0) {
      result = true;
      reason = "thinking-content";
    } else if (runtime.startedAt || runtime.finishedAt) {
      result = true;
      reason = "runtime-timing";
    }
    const thinkingDetail = result ? null : getThinkingDetailForMessage(messageItem);
    if (!result && thinkingDetail) {
      const detailMessage = thinkingDetail.messageItem || messageItem;
      result =
        getAllRealtimeLogs(detailMessage).length > 0 ||
        getCompletedToolLogsForMessage(detailMessage).length > 0;
      reason = result ? "loaded-detail" : "loaded-detail-empty";
    }
    if (!result && getAnalysisActivityTimeline(messageItem).length > 0) {
      result = true;
      reason = "activity-timeline";
    }
    if (!result && String(props.variant || "panel") === "details") {
      result = getCompletedToolLogsForMessage(messageItem).length > 0;
      reason = result ? "details-completed-tools" : reason;
    }
    const hasRealtimeLogs = !result && getRealtimeLogs(messageItem).length > 0;
    if (hasRealtimeLogs) {
      result = true;
      reason = "realtime";
    }
    if (!result && getCompletedToolLogsForMessage(messageItem).length > 0) {
      result = true;
      reason = "completed-tools";
    }
    logThinkingReplayDebug("frontend.thinkingReplay.visibilityEvaluated", () => ({
      ...thinkingReplayScope(messageItem),
      variant: String(props.variant || "panel"),
      result,
      reason,
      runtime,
      loadKey: thinkingDetailLoadKey.value,
      loadingKey: thinkingDetailLoadingKey.value,
      hasLoadedDetail: Boolean(loadedThinkingDetail.value),
      message: summarizeThinkingMessage(messageItem),
      detail: summarizeThinkingMessage(thinkingDetail?.messageItem || {}),
      currentExecutionLogCount: currentExecutionLogs.value.length,
      currentExecutionLogs: currentExecutionLogs.value.slice(-10).map(summarizeRealtimeLog),
    }));
    return result;
  }

  function isMessageRuntimeRunning(messageItem = {}) {
    return getRuntimeView(messageItem).running;
  }

  function getCompletedToolLogsForMessage(messageItem = {}) {
    return getAllCompletedLogs(messageItem);
  }

  return {
    detailPagination,
    thinkingContentItems,
    hasThinking,
    loadedThinkingDetail,
    currentExecutionLogs,
    latestTaskCheckReceipt,
    taskCheckReceipts,
    getAnalysisActivityTimeline,
    getLatestModelAnalysisLog,
    getExecutionLogs,
    getCanonicalExecutionLogs,
    getExecutionLogCount,
    getThinkingDetailCount,
    getThinkingDetailForMessage,
    getCompletedToolLogsForMessage,
    isMessageRuntimeRunning,
  };
}
