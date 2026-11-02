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
  selectedNodeSessionMetadata,
  selectedNodeSessionId,
}) {
  function normalizeNodeMessageForDisplay(messageItem) {
    return {
      ...messageItem,
      pluginMessage: false,
    };
  }

  function buildNodeViewMessage(messageItem) {
    return normalizeNodeMessageForDisplay(
      buildViewMessage(messageItem, {
        sessionId: selectedNodeSessionId.value,
        userId: props.userId,
      }),
    );
  }

  const selectedNodeSessionDocs = computed(() => {
    const sessionId = text(selectedNodeSessionId.value);
    if (!sessionId) return [];
    return [
      {
        ...selectedNodeSessionMetadata.value,
        sessionId,
        messages: selectedNodeMessages.value,
      },
    ];
  });

  const selectedNodeProjection = computed(() =>
    buildSessionDetailProjection({
      sessionDetail: {
        sessionId: selectedNodeSessionId.value,
        messages: selectedNodeMessages.value,
      },
      sessionDocs: selectedNodeSessionDocs.value,
      makeViewMessage: buildNodeViewMessage,
    }),
  );

  const normalizedNodeSessionMessages = computed(() => {
    return selectedNodeProjection.value.messages;
  });

  const displayNodeMessages = computed(() =>
    normalizedNodeSessionMessages.value.map((messageItem) =>
      normalizeNodeMessageForDisplay(messageItem),
    ),
  );

  function summarizeMessage(messageItem = {}) {
    return {
      messageUid: text(messageItem?.messageUid),
      presentationMessageId: text(messageItem?.presentationMessageId),
      role: text(messageItem?.role),
      type: text(messageItem?.type),
      sessionId: text(messageItem?.sessionId),
      dialogProcessId: text(messageItem?.dialogProcessId),
      turnScopeId: text(messageItem?.turnScopeId),
      pending: messageItem?.pending === true,
      contentLength: String(messageItem?.content || "").length,
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
      source: selectedNodeMessages.value.map(summarizeMessage),
      display: displayNodeMessages.value.map(summarizeMessage),
    }),
    (projection) => {
      props.logWorkflowDiagnostics("frontend.workflowNodeDetail.displayProjected", {
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

  const selectedActionNodeStates = computed(() => {
    const nodeItem = selectedRuntimeNode.value;
    return nodeItem === null ? [] : nodeItem.actionNodeStates;
  });

  watch(
    () => ({
      sessionId: text(selectedNodeSessionId.value),
      nodeExecutionId: text(selectedRuntimeNode.value?.nodeExecutionId),
      nodeId: text(selectedRuntimeNode.value?.nodeId),
      boxCount: selectedActionNodeStates.value.length,
      stepCount: selectedActionNodeStates.value.reduce(
        (count, box = {}) => count + (Array.isArray(box?.steps) ? box.steps.length : 0),
        0,
      ),
      boxIds: selectedActionNodeStates.value.map((box = {}) => text(box?.actionNodeStateId)),
    }),
    (projection) => {
      props.logWorkflowDiagnostics("frontend.workflowNodeDetail.actionNodeStatesProjected", {
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
    displayNodeMessages,
    selectedActionNodeStates,
  };
}
