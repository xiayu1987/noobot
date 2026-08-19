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
    const sessionId = String(
      selectedNodeSessionId.value || summary?.sessionId || selectedNode.value?.sessionId || "",
    ).trim();
    if (!sessionId) return [];
    return [
      {
        ...summary,
        sessionId,
        parentSessionId: String(
          summary?.parentSessionId || selectedNode.value?.rootSessionId || "",
        ).trim(),
        caller: String(summary?.caller || "bot").trim() || "bot",
        depth: Number.isFinite(Number(summary?.depth)) ? Number(summary.depth) : 1,
        // selectedNodeMessages is the canonical live projection. sessionSummary.messages
        // is only a transport snapshot and may lag behind or contain a pre-folded copy.
        // Reading it here created a second message fact source: live events updated the
        // canonical list while rendering continued to use the stale snapshot, and a
        // later detail reload could fold both copies into one duplicated content body.
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
      sessionId: String(messageItem?.sessionId || selectedNodeSessionId.value || "").trim(),
    })),
  );

  function summarizeMessage(messageItem = {}) {
    return {
      id: String(messageItem?.id || messageItem?.messageId || "").trim(),
      messageUid: String(messageItem?.messageUid || "").trim(),
      presentationMessageId: String(messageItem?.presentationMessageId || "").trim(),
      role: String(messageItem?.role || "").trim(),
      type: String(messageItem?.type || "").trim(),
      sessionId: String(messageItem?.sessionId || "").trim(),
      dialogProcessId: String(messageItem?.dialogProcessId || "").trim(),
      turnScopeId: String(messageItem?.turnScopeId || "").trim(),
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
        sessionId: String(projection.sessionId || "").trim(),
        dialogProcessId: String(selectedNode.value?.dialogProcessId || "").trim(),
        turnScopeId: String(selectedNode.value?.turnScopeId || "").trim(),
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
      sessionId: String(selectedNodeSessionId.value || "").trim(),
      nodeExecutionId: String(selectedRuntimeNode.value?.nodeExecutionId || "").trim(),
      nodeId: String(selectedRuntimeNode.value?.nodeId || "").trim(),
      boxCount: selectedRuntimeBoxes.value.length,
      stepCount: selectedRuntimeBoxes.value.reduce(
        (count, box = {}) => count + (Array.isArray(box?.steps) ? box.steps.length : 0),
        0,
      ),
      boxIds: selectedRuntimeBoxes.value.map((box = {}) =>
        String(box?.actionNodeStateId || box?.nodeStateId || "").trim(),
      ),
    }),
    (projection) => {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeBoxesProjected", {
        sessionId: projection.sessionId,
        dialogProcessId: String(selectedRuntimeNode.value?.dialogProcessId || "").trim(),
        turnScopeId: String(selectedRuntimeNode.value?.turnScopeId || "").trim(),
        workflowRunId: String(selectedRuntimeNode.value?.workflowRunId || "").trim(),
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
