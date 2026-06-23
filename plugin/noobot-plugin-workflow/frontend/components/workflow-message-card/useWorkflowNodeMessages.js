/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { computed } from "vue";
import { applyCompletedToolLogsToMessages } from "../../../../../client/noobot-chat/src/composables/infra/sessionToolLogs";
import { buildViewMessage, foldConversationMessages } from "../../../../../client/noobot-chat/src/composables/infra/messageModel";

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
      selectedNodeSessionId.value ||
        summary?.sessionId ||
        selectedNode.value?.sessionId ||
        "",
    ).trim();
    if (!sessionId) return [];
    return [
      {
        ...summary,
        sessionId,
        parentSessionId: String(
          summary?.parentSessionId ||
            selectedNode.value?.rootSessionId ||
            "",
        ).trim(),
        caller: String(summary?.caller || "bot").trim() || "bot",
        depth: Number.isFinite(Number(summary?.depth)) ? Number(summary.depth) : 1,
        messages: Array.isArray(summary?.messages)
          ? summary.messages
          : Array.isArray(selectedNodeMessages.value)
            ? selectedNodeMessages.value
            : [],
        toolLogSummaries: Array.isArray(summary?.toolLogSummaries)
          ? summary.toolLogSummaries
          : [],
      },
    ];
  });
  
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
    const sessionDocs = selectedNodeSessionDocs.value;
    const mainSessionDoc = sessionDocs[0] || {};
    const foldedMessages = foldConversationMessages(
      Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages : [],
      buildNodeViewMessage,
    );
    applyCompletedToolLogsToMessages(foldedMessages, selectedNodeToolSessionDocs.value);
    return foldedMessages;
  });
  
  const displayNodeMessages = computed(() =>
    (Array.isArray(normalizedNodeSessionMessages.value)
      ? normalizedNodeSessionMessages.value
      : []
    ).map((messageItem = {}) => normalizeNodeMessageForDisplay(messageItem)),
  );
  
  const nodeSessionAllMessages = computed(() => {
    const rawMessages = Array.isArray(selectedNodeRawMessages.value)
      ? selectedNodeRawMessages.value
      : [];
    if (rawMessages.length) return rawMessages.map((messageItem = {}) => buildNodeViewMessage(messageItem));
    return Array.isArray(rawNodeSessionMessages.value) ? rawNodeSessionMessages.value : [];
  });
  
  const selectedRuntimeBoxes = computed(() => {
    const nodeItem = selectedRuntimeNode.value || selectedNode.value || {};
    if (Array.isArray(nodeItem?.actionNodeStates)) return nodeItem.actionNodeStates;
    if (Array.isArray(nodeItem?.runtimeBoxes)) return nodeItem.runtimeBoxes;
    return [];
  });

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
