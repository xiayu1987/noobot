/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "../i18n/useLocale";
import { isHarnessInjectedMessage } from "../../composables/infra/messageModel";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
} from "../../composables/infra/messageIdentity";
import { sanitizeExecutionLogForDisplay } from "../../composables/chat/chatEngine/utils";
import {
  formatDurationMs,
  nowMs,
  resolveThinkingDurationMs,
  resolveTimeMs,
} from "../../composables/infra/timeFields";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { logReconnectTimingDebug } from "../../composables/chat/debug/reconnectTimingDebugLogger";
import { normalizeThinkingToolLogs } from "../../composables/infra/thinkingDetailModel";
import {
  getCachedThinkingDetail,
  loadThinkingDetail,
  resolveThinkingDetailIdentity,
} from "./thinkingDetailCache";

export function useThinkingPanel(props, emit) {
  const thinkingDetailLoadingKey = ref("");
  const loadedThinkingDetail = ref(null);
  const injectedMessages = computed(() =>
    getInjectedMessagesForMessage(props.messageItem),
  );
  const hasThinking = computed(
    () => {
      // Read the asynchronously committed detail directly. This computed drives
      // component mounting, so it must not rely only on an indirect cache lookup.
      const detailMessageItem = loadedThinkingDetail.value?.messageItem;
      return hasThinkingLogs(detailMessageItem || props.messageItem) ||
        injectedMessages.value.length > 0;
    },
  );
  const { translate } = useLocale();
  const nowTick = ref(nowMs());
  function getThinkingDurationLabel() {
    const durationMs = getThinkingDurationMs(props.messageItem);
    return durationMs === null ? "--:--" : formatDurationMs(durationMs);
  }
  const detailExpansionTick = ref(0);
  let timer = null;
  const EXECUTION_LOG_DISPLAY_LIMIT =
    QUANTITY_THRESHOLDS.client.executionLogDisplayLimit;

  function getRuntimeView() {
    return props.runtime || { running: false, terminal: false, startedAt: "", finishedAt: "" };
  }

  function getRealtimeLogs(messageItem = {}) {
    return getAllRealtimeLogs(messageItem)
      .filter((logItem) => !isPluginCapabilityResponseLog(logItem))
      .filter((logItem) => !isGuidanceAnalysisResponseLog(logItem))
      .filter((logItem) => !isMainModelContentLog(logItem))
      .map((logItem) => sanitizeExecutionLogForDisplay(logItem))
      .filter(Boolean)
      .slice(-EXECUTION_LOG_DISPLAY_LIMIT);
  }

  function getAllRealtimeLogs(messageItem = {}) {
    if (Array.isArray(messageItem?.processRealtimeLogs))
      return messageItem.processRealtimeLogs;
    return Array.isArray(messageItem?.realtimeLogs)
      ? messageItem.realtimeLogs
      : [];
  }

  function isFreshPendingAssistant(messageItem = {}) {
    return (
      getMessageRole(messageItem) === "assistant" &&
      messageItem?.pending === true &&
      messageItem?.hasFirstStreamEvent !== true
    );
  }

  function getExecutionLogs(messageItem = {}) {
    const realtimeLogs = getRealtimeLogs(messageItem);
    if (realtimeLogs.length > 0) return realtimeLogs;
    return getCompletedToolLogsForMessage(messageItem).slice(
      -EXECUTION_LOG_DISPLAY_LIMIT,
    );
  }

  function getAllCompletedLogs(messageItem = {}) {
    const loadedDetail = getThinkingDetailForMessage(messageItem);
    const detailMessageItem = loadedDetail?.messageItem || messageItem;
    const detailAllMessages = Array.isArray(loadedDetail?.allMessages)
      ? loadedDetail.allMessages
      : props.allMessages;
    const detailSessionDocs = Array.isArray(loadedDetail?.sessionDocs)
      ? loadedDetail.sessionDocs
      : Array.isArray(loadedDetail?.sessions)
        ? loadedDetail.sessions
        : props.sessionDocs;
    if (
      isAssistantWithoutTurnScope(detailMessageItem) &&
      String(props.variant || "panel") !== "details"
    ) return [];
    return normalizeThinkingToolLogs({
      messageItem: detailMessageItem,
      allMessages: detailAllMessages,
      sessionDocs: detailSessionDocs,
      variant: props.variant,
      toolResultFallback: translate("message.toolResultFallback"),
    });
  }

  function normalizeLogString(value = "") {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function isPluginAnalysisResponseLog(logItem = {}) {
    const eventName = normalizeLogString(logItem?.event || logItem?.type);
    const purpose = normalizeLogString(
      logItem?.purpose || logItem?.data?.purpose,
    );
    const pluginFlow = normalizeLogString(
      logItem?.pluginFlow ||
        logItem?.data?.pluginFlow ||
        logItem?.harnessFlow ||
        logItem?.data?.harnessFlow,
    );
    const chain = normalizeLogString(
      logItem?.chain ||
        logItem?.data?.chain ||
        logItem?.executionScope ||
        logItem?.data?.executionScope,
    );
    return (
      isGuidanceAnalysisEventName(eventName) &&
      purpose === "guidance" &&
      pluginFlow === "analysis" &&
      chain === "auxiliary"
    );
  }

  function isGuidanceAnalysisEventName(eventName = "") {
    return (
      eventName === "guidance_analysis_response" ||
      eventName === "guidance_analysis"
    );
  }

  function isGuidanceAnalysisResponseLog(logItem = {}) {
    const eventName = normalizeLogString(
      logItem?.event || logItem?.type || logItem?.rawEvent,
    );
    return isGuidanceAnalysisEventName(eventName);
  }

  function isMainModelContentLog(logItem = {}) {
    const eventName = normalizeLogString(
      logItem?.event || logItem?.type || logItem?.rawEvent,
    );
    return eventName === "main_model_content";
  }

  function getMainModelContentLogOutput(logItem = {}) {
    return String(
      logItem?.output ??
        logItem?.data?.output ??
        logItem?.text ??
        logItem?.data?.text ??
        "",
    ).trim();
  }

  function getLatestMainModelContentLog(messageItem = {}) {
    const logs = [
      ...getAllRealtimeLogs(messageItem),
      ...getAllCompletedLogs(messageItem),
    ].filter(isMainModelContentLog);
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const output = getMainModelContentLogOutput(logs[index]);
      if (output) return { ...logs[index], output };
    }
    return null;
  }

  function isPluginCapabilityResponseLog(logItem = {}) {
    const eventName = normalizeLogString(logItem?.event || logItem?.type);
    return (
      eventName === "plugin_capability_response" ||
      eventName === "harness_capability_response"
    );
  }

  function getPluginAnalysisLogOutput(logItem = {}) {
    const output = String(
      logItem?.output ?? logItem?.data?.output ?? "",
    ).trim();
    if (output) return output;
    const text = String(logItem?.text || "").trim();
    return text
      .replace(/^(?:Plugin|Harness)\s+模型返回\s*\/\s*[^\n]+\n?/i, "")
      .trim();
  }

  function getLatestPluginAnalysisLog(messageItem = {}) {
    const logs = [
      ...getAllRealtimeLogs(messageItem),
      ...getAllCompletedLogs(messageItem),
    ].filter(isPluginAnalysisResponseLog);
    for (let index = logs.length - 1; index >= 0; index -= 1) {
      const output = getPluginAnalysisLogOutput(logs[index]);
      if (output) return { ...logs[index], output };
    }
    return null;
  }

  function getExecutionLogCount(messageItem = {}) {
    const explicitTotal = toValidExecutionLogTotal(
      messageItem.processExecutionLogTotal ??
        messageItem.executionLogTotal ??
        messageItem.execution_log_total,
    );
    if (explicitTotal !== null) {
      const hiddenAnalysisLogCount = [
        ...getAllRealtimeLogs(messageItem),
        ...getAllCompletedLogs(messageItem),
      ].filter(
        (logItem) =>
          isPluginCapabilityResponseLog(logItem) ||
          isGuidanceAnalysisResponseLog(logItem) ||
          isMainModelContentLog(logItem),
      ).length;
      return Math.max(0, explicitTotal - hiddenAnalysisLogCount);
    }

    const realtimeLogs = getAllRealtimeLogs(messageItem).filter(
      (logItem) =>
        !isPluginCapabilityResponseLog(logItem) &&
        !isGuidanceAnalysisResponseLog(logItem) &&
        !isMainModelContentLog(logItem),
    );
    if (realtimeLogs.length > 0) return realtimeLogs.length;

    const completedToolLogs = getCompletedToolLogsForMessage(messageItem);
    if (completedToolLogs.length > 0) return completedToolLogs.length;

    const summaryThinkingDetailCount =
      getSummaryThinkingDetailCount(messageItem);
    if (summaryThinkingDetailCount > 0) return summaryThinkingDetailCount;

    return getExecutionLogs(messageItem).length;
  }

  function toValidExecutionLogTotal(value) {
    const total = Number(value);
    return Number.isFinite(total) && total >= 0 ? total : null;
  }

  function getSummaryThinkingDetailCount(messageItem = {}) {
    const count = Number(
      messageItem?.thinkingDetailCount ?? messageItem?.thinking_detail_count,
    );
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  function hasSummaryThinkingDetails(messageItem = {}) {
    return (
      messageItem?.hasThinkingDetails === true ||
      getSummaryThinkingDetailCount(messageItem) > 0
    );
  }

  function hasLocalThinkingDetails(messageItem = {}) {
    const completedLogs = Array.isArray(messageItem?.completedToolLogs)
      ? messageItem.completedToolLogs
      : Array.isArray(messageItem?.processCompletedToolLogs)
        ? messageItem.processCompletedToolLogs
        : [];
    return (
      getAllRealtimeLogs(messageItem).length > 0 ||
      completedLogs.length > 0 ||
      injectedMessages.value.length > 0
    );
  }

  function getThinkingDetailForMessage(messageItem = {}) {
    // Read the reactive ref first so template consumers (getExecutionLogs ->
    // getAllCompletedLogs) establish a render dependency on loadedThinkingDetail.
    // The load watcher writes both fetched and cache-hit details into this ref,
    // so an async assignment always triggers a re-render. The cache lookup is
    // only a synchronous fallback for the very first access before the watcher
    // has committed.
    const loaded = loadedThinkingDetail.value;
    const identity = resolveThinkingDetailIdentity(messageItem, props.messageItem?.sessionId || "");
    if (!identity.key) return loaded;
    if (loaded?.__thinkingDetailIdentity?.key === identity.key) return loaded;
    return getCachedThinkingDetail(identity) || null;
  }

  // The template must consume a computed that directly tracks the asynchronously
  // committed detail ref. Calling getExecutionLogs from the template alone can
  // retain the initial empty projection when the detail arrives after mount.
  const currentExecutionLogs = computed(() => {
    const detail = loadedThinkingDetail.value;
    return getExecutionLogs(detail?.messageItem || props.messageItem);
  });

  const thinkingDetailLoadKey = computed(() => {
    const messageItem = props.messageItem || {};
    if (String(props.variant || "panel") === "details") return "";
    if (hasLocalThinkingDetails(messageItem)) return "";
    // The compact Session projection is allowed to omit thinking summary
    // fields.  It can also briefly retain a hydrated `running` runtime after a
    // reload.  Neither is authoritative for detail availability.  A settled
    // assistant message with a canonical identity must try the scoped detail
    // endpoint; a missing artifact is handled as a normal cache miss below.
    // During a live send, pending/local realtime logs continue to own display
    // and prevent this request.
    if (messageItem?.pending === true) return "";
    const identity = resolveThinkingDetailIdentity(messageItem, props.messageItem?.sessionId || "");
    return identity.key || "";
  });

  watch(
    thinkingDetailLoadKey,
    async (key) => {
      if (!key) return;
      const messageItem = props.messageItem || {};
      const identity = resolveThinkingDetailIdentity(messageItem, props.messageItem?.sessionId || "");
      if (!identity.key) return;
      const cached = getCachedThinkingDetail(identity);
      if (cached) {
        loadedThinkingDetail.value = { ...cached, __thinkingDetailIdentity: identity };
        return;
      }
      try {
        thinkingDetailLoadingKey.value = key;
        const detail = await loadThinkingDetail({
          userId: props.userId,
          sessionId: identity.sessionId,
          messageItem,
          dialogProcessId: identity.dialogProcessId,
          turnScopeId: identity.turnScopeId,
          authFetch: props.authFetch,
        });
        // `loadThinkingDetail` writes through the shared cache before resolving.
        // That cache hit makes `hasLocalThinkingDetails()` true, so
        // thinkingDetailLoadKey can legitimately clear while this same request is
        // completing. Do not let the request cancel itself; only discard it when
        // the panel now points at a different thinking-detail identity.
        if (!detail) return;
        // This watcher run owns the captured identity. The cache write performed
        // by loadThinkingDetail can make thinkingDetailLoadKey clear while the
        // request is resolving; that is not cancellation and must not prevent
        // committing the canonical detail to the reactive display source.
        loadedThinkingDetail.value = { ...detail, __thinkingDetailIdentity: identity };
      } catch {
        // Keep summary-only panels stable; the explicit details drawer reports errors.
      } finally {
        if (thinkingDetailLoadingKey.value === key) {
          thinkingDetailLoadingKey.value = "";
        }
      }
    },
    { immediate: true },
  );

  function hasThinkingLogs(messageItem = {}) {
    if (!messageItem || getMessageRole(messageItem) !== "assistant")
      return false;
    if (getRuntimeView(messageItem).running) return true;
    if (hasSummaryThinkingDetails(messageItem)) return true;
    // A compact refresh payload may omit hasThinkingDetails/count. Once the
    // scoped detail request resolves, let that canonical detail itself make the
    // panel visible instead of continuing to key visibility only off summary
    // metadata that is not guaranteed to be present.
    const thinkingDetail = getThinkingDetailForMessage(messageItem);
    if (thinkingDetail) {
      return getCompletedToolLogsForMessage(
        thinkingDetail.messageItem || messageItem,
      ).length > 0;
    }
    if (getLatestPluginAnalysisLog(messageItem)) return true;
    if (String(props.variant || "panel") === "details") {
      return getCompletedToolLogsForMessage(messageItem).length > 0;
    }
    const hasRealtimeLogs =
      Array.isArray(messageItem.processRealtimeLogs) ||
      Array.isArray(messageItem.realtimeLogs)
        ? getRealtimeLogs(messageItem).length > 0
        : false;
    if (hasRealtimeLogs) return true;
    return getCompletedToolLogsForMessage(messageItem).length > 0;
  }

  function isMessageRuntimeRunning(messageItem = {}) {
    return getRuntimeView(messageItem).running;
  }

  function isSameFrontendTurnScope(target = {}, candidate = {}) {
    const targetTurnScopeId = getMessageTurnScopeId(target);
    const candidateTurnScopeId = getMessageTurnScopeId(candidate);
    if (targetTurnScopeId && candidateTurnScopeId) {
      const targetSessionId = getMessageSessionId(target);
      const candidateSessionId = getMessageSessionId(candidate);
      return (
        targetTurnScopeId === candidateTurnScopeId &&
        (!targetSessionId ||
          !candidateSessionId ||
          targetSessionId === candidateSessionId)
      );
    }
    return false;
  }

  function getInjectedMessagesForMessage(messageItem = {}) {
    if (!messageItem || getMessageRole(messageItem) !== "assistant") return [];
    if (isFreshPendingAssistant(messageItem)) return [];
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    const candidateMessages = Array.isArray(props.allMessages)
      ? props.allMessages
      : [];
    return candidateMessages.filter((item = {}) => {
      if (!isHarnessInjectedMessage(item)) return false;
      if (isSameFrontendTurnScope(messageItem, item)) return true;
      if (!getMessageTurnScopeId(messageItem) && dialogProcessId) {
        return getMessageDialogProcessId(item) === dialogProcessId;
      }
      return !getMessageTurnScopeId(messageItem) && !dialogProcessId;
    });
  }

  function getCompletedToolLogsForMessage(messageItem = {}) {
    const seen = new Set();
    return getAllCompletedLogs(messageItem)
      .filter((logItem) => !isPluginCapabilityResponseLog(logItem))
      .filter((logItem) => {
        // Session hydration can temporarily expose the same result both in
        // the normalized log list and in the raw message projection. Keep the
        // first event for a call id; otherwise the details drawer counts one
        // tool execution twice.
        const event = String(logItem?.event || logItem?.type || "").trim();
        const callId = String(
          logItem?.toolCallId || logItem?.tool_call_id || "",
        ).trim();
        if (!callId) return true;
        const key = `${event}:${callId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      // normalizeThinkingToolLogs is the canonical adapter for persisted
      // thinking details. Its text is already the final persisted display
      // value; sanitizing it again rewrites text-only tool_result entries into
      // a generic "completed" label and loses the restored result text.
      // Keep normalized text intact, while retaining the sanitizer fallback
      // for legacy entries whose display text still needs to be derived.
      .map((logItem) => {
        const normalizedText = String(logItem?.text || "").trim();
        return normalizedText ? { ...logItem, text: normalizedText }
          : sanitizeExecutionLogForDisplay(logItem);
      })
      .filter(Boolean);
  }

  function getInjectedMessageCount() {
    return injectedMessages.value.length;
  }

  function formatInjectedMessageTitle(messageItem = {}, messageIndex = 0) {
    const timeText = String(messageItem?.ts || "").trim();
    const sourceText = String(
      messageItem?.injectedBy || translate("message.injectedSourceHarness"),
    ).trim();
    return `${messageIndex + 1}. ${sourceText}${timeText ? ` · ${timeText}` : ""}`;
  }

  function formatSessionGroupLabel(
    sessionId = "",
    depth = 0,
    turnScopeId = "",
  ) {
    const shortSessionId =
      String(sessionId || "").slice(0, 8) || translate("message.unknownShort");
    const shortTurnScopeId =
      String(turnScopeId || "")
        .replace(/^client-turn:/, "")
        .slice(0, 8) || translate("message.unknownShort");
    const levelText = translate("message.depthLabel", {
      depth: Math.max(1, Number(depth || 1)),
    });
    if (Number(depth || 0) <= 1) {
      return translate("message.mainTaskGroup", {
        sessionId: shortSessionId,
        turnScopeId: shortTurnScopeId,
        level: levelText,
      });
    }
    return translate("message.subTaskGroup", {
      sessionId: shortSessionId,
      turnScopeId: shortTurnScopeId,
      level: levelText,
    });
  }

  function groupCompletedToolLogs(messageItem = {}) {
    const toolLogs = getCompletedToolLogsForMessage(messageItem)
      .map((logItem, sourceIndex) => ({ logItem, sourceIndex }))
      .sort((left, right) => {
        const leftTime = resolveTimeMs(left.logItem?.ts);
        const rightTime = resolveTimeMs(right.logItem?.ts);
        if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.sourceIndex - right.sourceIndex;
      })
      .map(({ logItem }) => logItem);
    if (toolLogs.length <= 0) return [];
    return [{
      key: "tool-timeline",
      label: "",
      items: toolLogs,
    }];
  }

  function collapseThinkingPanel(messageItem = {}) {
    messageItem.thinkingOpenNames = [];
  }

  function openThinkingDetailDrawer() {
    emit("open-thinking-details", {
      messageItem: props.messageItem,
      allMessages: props.allMessages,
      sessionDocs: props.sessionDocs,
    });
  }

  function getThinkingDetailItemKey(
    groupedToolLogs,
    toolLogItem,
    toolLogIndex,
  ) {
    return `${String(groupedToolLogs?.key || "")}|${toolLogIndex}|${String(toolLogItem?.ts || "")}|${String(toolLogItem?.event || "")}`;
  }

  function isThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
    // Some callers (workflow node drawer) pass computed/plain message objects,
    // not Pinia/reactive store objects. Track this tick so click-to-expand still
    // forces a render after mutating expandedDetailLogKeys.
    detailExpansionTick.value;
    return Array.isArray(messageItem?.expandedDetailLogKeys)
      ? messageItem.expandedDetailLogKeys.includes(detailItemKey)
      : false;
  }

  function toggleThinkingDetailExpanded(messageItem = {}, detailItemKey = "") {
    if (!detailItemKey) return;
    const currentKeys = Array.isArray(messageItem?.expandedDetailLogKeys)
      ? messageItem.expandedDetailLogKeys
      : [];
    if (currentKeys.includes(detailItemKey)) {
      messageItem.expandedDetailLogKeys = currentKeys.filter(
        (itemKey) => itemKey !== detailItemKey,
      );
      detailExpansionTick.value += 1;
      return;
    }
    messageItem.expandedDetailLogKeys = [...currentKeys, detailItemKey];
    detailExpansionTick.value += 1;
  }

  function getThinkingDetailCount(messageItem = {}) {
    const completedToolLogCount =
      getCompletedToolLogsForMessage(messageItem).length;
    if (completedToolLogCount > 0) return completedToolLogCount;
    const summaryThinkingDetailCount =
      getSummaryThinkingDetailCount(messageItem);
    if (summaryThinkingDetailCount > 0) return summaryThinkingDetailCount;
    const toolCalls = Array.isArray(messageItem?.toolCalls)
      ? messageItem.toolCalls
      : Array.isArray(messageItem?.tool_calls)
        ? messageItem.tool_calls
        : [];
    if (toolCalls.length > 0) return toolCalls.length;
    const realtimeLogs = Array.isArray(messageItem?.processRealtimeLogs)
      ? messageItem.processRealtimeLogs
      : Array.isArray(messageItem?.realtimeLogs)
        ? messageItem.realtimeLogs
        : [];
    return realtimeLogs.filter((logItem = {}) => {
      const event = String(logItem?.event || logItem?.type || "").toLowerCase();
      return event.includes("tool") || event.includes("function");
    }).length;
  }

  function getThinkingDetailLabel(messageItem = {}) {
    return translate("message.thinkingDetails", {
      count: getThinkingDetailCount(messageItem),
    });
  }

  function getThinkingTreePrefix(toolLogItem = {}) {
    const depth = Math.max(1, Number(toolLogItem?.depth || 1));
    if (depth <= 1) return "•";
    return `${"│  ".repeat(Math.max(0, depth - 2))}└─`;
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
    (running, wasRunning) => {
      if (running) {
        startTimer();
        // Runtime state is the source of truth for the current response. The
        // message is often created before `pending` is projected, so relying on
        // the creation-time default leaves the live panel collapsed.
        props.messageItem.thinkingOpenNames = ["thinking-panel"];
      } else {
        stopTimer();
        // Fold only when the live response actually becomes history. Do not
        // overwrite a historical panel that the user opened manually.
        if (wasRunning === true) props.messageItem.thinkingOpenNames = [];
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    stopTimer();
  });

  return {
    injectedMessages,
    hasThinking,
    translate,
    getThinkingDurationLabel,
    isThinkingRuntimeRunning,
    getLatestPluginAnalysisLog,
    getLatestMainModelContentLog,
    getExecutionLogs,
    currentExecutionLogs,
    loadedThinkingDetail,
    getExecutionLogCount,
    getThinkingDetailLabel,
    openThinkingDetailDrawer,
    collapseThinkingPanel,
    isMessageRuntimeRunning,
    groupCompletedToolLogs,
    getThinkingDetailCount,
    getThinkingTreePrefix,
    getThinkingDetailItemKey,
    isThinkingDetailExpanded,
    toggleThinkingDetailExpanded,
    formatInjectedMessageTitle,
  };
}
