/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { createTurnRuntimeRegistryState } from "../../composables/chat/sessionRunStateMachine/turnRuntimeRegistry.js";
import { createTurnRuntimeStoreActions } from "./chatStoreTurnRuntime.js";
import { createChatExecutionSelectors } from "./chatStoreExecutionSelectors.js";
import { createSubSessionMessageRegistry, createSubSessionStore } from "./chatStoreSubSessions.js";
import { createWorkflowNodeStateRegistry, createWorkflowStore } from "./chatStoreWorkflows.js";

export const useChatStore = defineStore("chat", () => {
  const input=ref(""); const uploadFiles=ref([]);
  const turnRuntimeRegistry=ref(createTurnRuntimeRegistryState());
  const workflowNodeStateRegistry=ref(createWorkflowNodeStateRegistry());
  const subSessionMessageRegistry=ref(createSubSessionMessageRegistry());
  const sessions=ref([]); const activeSessionId=ref("");
  const loadingSessions=ref(false); const loadingSessionDetail=ref(false);
  const pendingInteractionRequest=ref(null); const pendingInteractionRequests=ref([]); const interactionSubmitting=ref(false);
  const activeSession=computed(()=>sessions.value.find(item=>item.id===activeSessionId.value));
  const turnActions=createTurnRuntimeStoreActions(turnRuntimeRegistry);
  const subSessions=createSubSessionStore({subSessionMessageRegistry});
  const workflows=createWorkflowStore({workflowNodeStateRegistry,subSessionMessageRegistry,upsertSubSessionEvent:subSessions.upsertSubSessionEvent});
  const executionSelectors=createChatExecutionSelectors({turnRuntimeRegistry,sessions,selectSubSessionMessages:subSessions.selectSubSessionMessages});
  function resetChatStore(){ input.value=""; uploadFiles.value=[]; turnRuntimeRegistry.value=createTurnRuntimeRegistryState(); workflowNodeStateRegistry.value=createWorkflowNodeStateRegistry(); subSessionMessageRegistry.value=createSubSessionMessageRegistry(); sessions.value=[]; activeSessionId.value=""; loadingSessions.value=false; loadingSessionDetail.value=false; pendingInteractionRequest.value=null; pendingInteractionRequests.value=[]; interactionSubmitting.value=false; }
  return { input,uploadFiles,turnRuntimeRegistry,workflowNodeStateRegistry,subSessionMessageRegistry,sessions,activeSessionId,activeSession,loadingSessions,loadingSessionDetail,pendingInteractionRequest,pendingInteractionRequests,interactionSubmitting,...turnActions,...workflows,...subSessions,...executionSelectors,resetChatStore };
});
