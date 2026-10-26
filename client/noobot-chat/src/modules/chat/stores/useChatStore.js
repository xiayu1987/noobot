/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createTurnRuntimeRegistryState } from "../runtime/run-state-machine/turnRuntimeRegistry.js";
import { createTurnRuntimeStoreActions } from "./chatStoreTurnRuntime.js";
import { createChatExecutionSelectors } from "./chatStoreExecutionSelectors.js";
import { createSubSessionStore } from "./chatStoreSubSessions.js";
import { createSubSessionMessageRegistry } from "./subSessionRegistry.js";
import { createWorkflowStore } from "./chatStoreWorkflows.js";
import { createWorkflowNodeStateRegistry } from "./workflowEventOperations.js";
import { createTurnRuntimeStoreCallbacks } from "./turnRuntimeStoreCallbacks.js";
import { isFinalTurnState } from "../runtime/run-state-machine/turnReducer.js";
import { text } from "@noobot/shared/value";

export const useChatStore = defineStore("chat", () => {
  const input = ref("");
  const uploadFiles = ref([]);
  const turnRuntimeRegistry = ref(createTurnRuntimeRegistryState());

  const workflowNodeStateRegistry = ref(createWorkflowNodeStateRegistry());
  const subSessionMessageRegistry = ref(createSubSessionMessageRegistry());
  const subSessionMessageRegistryVersion = ref(0);
  const sessions = ref([]);
  const activeSessionId = ref("");
  const loadingSessions = ref(false);
  const loadingSessionDetail = ref(false);
  const pendingInteractionRequest = ref(null);
  const pendingInteractionRequests = ref([]);
  const interactionSubmitting = ref(false);
  const activeSession = computed(() =>
    sessions.value.find((item) => item.sessionId === activeSessionId.value),
  );
  let subSessions = null;
  function closePendingInteractionsForTerminalTurn(turn = {}) {
    if (!isFinalTurnState(turn?.state, turn)) return 0;
    const sessionId = text(turn?.sessionId);
    const dialogProcessId = text(turn?.dialogProcessId);
    const turnScopeId = text(turn?.turnScopeId);
    if (!sessionId || !turnScopeId) return 0;
    const before = pendingInteractionRequests.value.length;
    pendingInteractionRequests.value = pendingInteractionRequests.value.filter((request = {}) => {
      if (text(request?.sessionId) !== sessionId) return true;
      const requestDialogProcessId = text(request?.dialogProcessId);
      if (dialogProcessId && requestDialogProcessId !== dialogProcessId) return true;
      const requestTurnScopeId = text(request?.turnScopeId);
      return requestTurnScopeId !== turnScopeId;
    });
    const activeId = text(activeSessionId.value);
    pendingInteractionRequest.value =
      pendingInteractionRequests.value.find(
        (request = {}) => text(request?.channelSessionId) === activeId,
      ) || null;
    if (!pendingInteractionRequest.value) interactionSubmitting.value = false;
    return before - pendingInteractionRequests.value.length;
  }
  const turnActions = createTurnRuntimeStoreActions(
    turnRuntimeRegistry,
    createTurnRuntimeStoreCallbacks({
      sessions,
      turnRuntimeRegistry,
      getSubSessions: () => subSessions,
      closePendingInteractionsForTerminalTurn,
    }),
  );
  subSessions = createSubSessionStore({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    turnRuntimeRegistry,

    selectWorkflowNodeState: (...args) => workflows.selectWorkflowNodeState(...args),
    applyTurnLifecycleSnapshot: turnActions.applyTurnLifecycleSnapshot,
    applyTurnTimingSnapshot: turnActions.applyTurnTimingSnapshot,
  });
  const workflows = createWorkflowStore({
    workflowNodeStateRegistry,
    ensureSubSessionMessageContainer: subSessions.ensureSubSessionMessageContainer,
    reduceSubSessionSnapshot: subSessions.reduceSubSessionSnapshot,
    removeSubSessionsByWorkflowRunIds: subSessions.removeSubSessionsByWorkflowRunIds,
  });
  const executionSelectors = createChatExecutionSelectors({
    turnRuntimeRegistry,
    sessions,
    selectSubSessionMessages: subSessions.selectSubSessionMessages,
  });
  function resetChatStore() {
    input.value = "";
    uploadFiles.value = [];
    turnRuntimeRegistry.value = createTurnRuntimeRegistryState();
    workflowNodeStateRegistry.value = createWorkflowNodeStateRegistry();
    subSessionMessageRegistry.value = createSubSessionMessageRegistry();
    subSessionMessageRegistryVersion.value += 1;
    sessions.value = [];
    activeSessionId.value = "";
    loadingSessions.value = false;
    loadingSessionDetail.value = false;
    pendingInteractionRequest.value = null;
    pendingInteractionRequests.value = [];
    interactionSubmitting.value = false;
  }
  return {
    input,
    uploadFiles,
    turnRuntimeRegistry,
    workflowNodeStateRegistry,
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    sessions,
    activeSessionId,
    activeSession,
    loadingSessions,
    loadingSessionDetail,
    pendingInteractionRequest,
    pendingInteractionRequests,
    interactionSubmitting,
    ...turnActions,
    ...workflows,
    reduceSubSessionMessageEvent: subSessions.reduceSubSessionMessageEvent,
    selectSubSessionMessages: subSessions.selectSubSessionMessages,
    ...executionSelectors,
    resetChatStore,
  };
});
