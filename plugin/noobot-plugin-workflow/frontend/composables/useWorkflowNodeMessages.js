/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, watch } from "vue";
import {
  buildSessionDetailProjection,
  buildViewMessage,
} from "noobot-chat/plugin-api/session-domain";
import { text } from "@noobot/shared/value";

export function useWorkflowNodeMessages({
  props,
  selectedNode,
  selectedRuntimeNode,
  selectedNodeMessages,
  selectedNodeRawMessages,
  selectedNodeSessionSummary,
  selectedNodeSessionId,
}) {
  function normalizeNodeMessageForDisplay(messageItem = {}) {
    const item = messageItem && typeof messageItem === "object" ? messageItem : {};
    return {
      ...item,
      pluginMessage: false,
      content: String(item?.content || ""),
    };
  }

  function buildNodeViewMessage(messageItem = {}) {
    return normalizeNodeMessageForDisplay(
      buildViewMessage(messageItem, {
        userId: props.userId,
        isImageMime: props.isImageMime,
      }),
    );
  }

  const selectedNodeSessionDocs = computed(() => {
    const summary =
      selectedNodeSessionSummary.value &&
      typeof selectedNodeSessionSummary.value === "object" &&
      !Array.isArray(selectedNodeSessionSummary.value)
        ? selectedNodeSessionSummary.value
        : {};
    const sessionId = text(
      selectedNodeSessionId.value || summary?.sessionId || selectedNode.value?.sessionId,
    );
    if (!sessionId) return [];
    return [
      {
        ...summary,
        sessionId,
        parentSessionId: text(summary?.parentSessionId || selectedNode.value?.rootSessionId),
        caller: String(summary?.caller || "bot").trim() || "bot",
        depth: Number.isFinite(Number(summary?.depth)) ? Number(summary.depth) : 1,

        messages: Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : [],
      },
    ];
  });

  const selectedNodeProjection = computed(() =>
    buildSessionDetailProjection({
      sessionDetail: {
        sessionId: selectedNodeSessionId.value,
        sessionSummary: selectedNodeSessionSummary.value || {},
        messages: selectedNodeMessages.value,
      },
      sessionDocs: selectedNodeSessionDocs.value,
      makeViewMessage: buildNodeViewMessage,
    }),
  );

  const rawNodeSessionMessages = computed(() =>
    (Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : []).map(
      (messageItem = {}) => buildNodeViewMessage(messageItem),
    ),
  );

  const selectedNodeToolSessionDocs = computed(() => {
    const sessionDocs = selectedNodeSessionDocs.value;
    const mainSessionDoc = sessionDocs[0] || {};
    const rawMessages = Array.isArray(selectedNodeRawMessages.value)
      ? selectedNodeRawMessages.value
      : [];
    if (!rawMessages.length) return sessionDocs;
    return [
      {
        ...mainSessionDoc,
        messages: rawMessages,
      },
    ];
  });

  const normalizedNodeSessionMessages = computed(() => {
    return selectedNodeProjection.value.messages;
  });

  const displayNodeMessages = computed(() =>
    (Array.isArray(normalizedNodeSessionMessages.value)
      ? normalizedNodeSessionMessages.value
      : []
    ).map((messageItem = {}) => ({
      ...normalizeNodeMessageForDisplay(messageItem),
      sessionId: text(messageItem?.sessionId || selectedNodeSessionId.value),
    })),
  );

  function summarizeMessage(messageItem = {}) {
    return {
      id: text(messageItem?.messageId),
      messageUid: text(messageItem?.messageUid),
      presentationMessageId: text(messageItem?.presentationMessageId),
      role: text(messageItem?.role),
      type: text(messageItem?.type),
      sessionId: text(messageItem?.sessionId),
      dialogProcessId: text(messageItem?.dialogProcessId),
      turnScopeId: text(messageItem?.turnScopeId),
      pending: messageItem?.pending === true,
      contentLength: String(messageItem?.content || "").length,
      rawEventCount: Array.isArray(messageItem?.rawEvents) ? messageItem.rawEvents.length : 0,
      activityTimelineCount: Array.isArray(messageItem?.activityTimeline)
        ? messageItem.activityTimeline.length
        : 0,
      toolTimelineCount: Array.isArray(messageItem?.toolTimeline)
        ? messageItem.toolTimeline.length
        : 0,
      toolCallCount: Array.isArray(messageItem?.tool_calls) ? messageItem.tool_calls.length : 0,
    };
  }

  watch(
    () => ({
      sessionId: selectedNodeSessionId.value,
      source: (Array.isArray(selectedNodeMessages.value) ? selectedNodeMessages.value : []).map(
        summarizeMessage,
      ),
      display: displayNodeMessages.value.map(summarizeMessage),
    }),
    (projection) => {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.displayProjected", {
        sessionId: text(projection.sessionId),
        dialogProcessId: text(selectedNode.value?.dialogProcessId),
        turnScopeId: text(selectedNode.value?.turnScopeId),
        sourceMessageCount: projection.source.length,
        displayMessageCount: projection.display.length,
        sourceMessages: projection.source,
        displayMessages: projection.display,
      });
    },
    { immediate: true },
  );

  const nodeSessionAllMessages = computed(() => {
    const rawMessages = Array.isArray(selectedNodeRawMessages.value)
      ? selectedNodeRawMessages.value
      : [];
    if (rawMessages.length)
      return rawMessages.map((messageItem = {}) => buildNodeViewMessage(messageItem));
    return Array.isArray(rawNodeSessionMessages.value) ? rawNodeSessionMessages.value : [];
  });

  const selectedRuntimeBoxes = computed(() => {
    const nodeItem = selectedRuntimeNode.value || selectedNode.value || {};
    if (Array.isArray(nodeItem?.actionNodeStates)) return nodeItem.actionNodeStates;
    if (Array.isArray(nodeItem?.runtimeBoxes)) return nodeItem.runtimeBoxes;
    return [];
  });

  watch(
    () => ({
      sessionId: text(selectedNodeSessionId.value),
      nodeExecutionId: text(selectedRuntimeNode.value?.nodeExecutionId),
      nodeId: text(selectedRuntimeNode.value?.nodeId),
      boxCount: selectedRuntimeBoxes.value.length,
      stepCount: selectedRuntimeBoxes.value.reduce(
        (count, box = {}) => count + (Array.isArray(box?.steps) ? box.steps.length : 0),
        0,
      ),
      boxIds: selectedRuntimeBoxes.value.map((box = {}) => text(box?.actionNodeStateId)),
    }),
    (projection) => {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeBoxesProjected", {
        sessionId: projection.sessionId,
        dialogProcessId: text(selectedRuntimeNode.value?.dialogProcessId),
        turnScopeId: text(selectedRuntimeNode.value?.turnScopeId),
        workflowRunId: text(selectedRuntimeNode.value?.workflowRunId),
        ...projection,
      });
    },
    { immediate: true },
  );

  return {
    selectedNodeSessionDocs,
    rawNodeSessionMessages,
    selectedNodeToolSessionDocs,
    normalizedNodeSessionMessages,
    displayNodeMessages,
    nodeSessionAllMessages,
    selectedRuntimeBoxes,
  };
}
