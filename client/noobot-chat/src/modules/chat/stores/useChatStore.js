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
import { createSubSessionMessageRegistry, createSubSessionStore } from "./chatStoreSubSessions.js";
import { createWorkflowStore } from "./chatStoreWorkflows.js";

export const useChatStore = defineStore("chat", () => {
  const input=ref(""); const uploadFiles=ref([]);
  const turnRuntimeRegistry=ref(createTurnRuntimeRegistryState());
  // Plugin-runtime projectors materialize plugin state through this single
  // reducer gateway; Turn/Execution authority remains in turnRuntimeRegistry.
  const workflowNodeStateRegistry=ref(null);
  const subSessionMessageRegistry=ref(createSubSessionMessageRegistry());
  const subSessionMessageRegistryVersion=ref(0);
  const sessions=ref([]); const activeSessionId=ref("");
  const loadingSessions=ref(false); const loadingSessionDetail=ref(false);
  const pendingInteractionRequest=ref(null); const pendingInteractionRequests=ref([]); const interactionSubmitting=ref(false);
  const activeSession=computed(()=>sessions.value.find(item=>item.id===activeSessionId.value));
  const turnActions=createTurnRuntimeStoreActions(turnRuntimeRegistry);
  const subSessions=createSubSessionStore({subSessionMessageRegistry,subSessionMessageRegistryVersion,turnRuntimeRegistry,applyTurnTimingSnapshot:turnActions.applyTurnTimingSnapshot});
  const workflows=createWorkflowStore({
    workflowNodeStateRegistry,
    applySubSessionLifecycleEvent:subSessions.applySubSessionLifecycleEvent,
    reduceSubSessionMessageEvent:subSessions.reduceSubSessionMessageEvent,
    reduceSubSessionSnapshot:subSessions.reduceSubSessionSnapshot,
    removeSubSessionsByWorkflowRunIds:subSessions.removeSubSessionsByWorkflowRunIds,
  });
  const executionSelectors=createChatExecutionSelectors({turnRuntimeRegistry,sessions,selectSubSessionMessages:subSessions.selectSubSessionMessages});
  function projectAppliedTurnRuntime(turn){
    const sessionId=String(turn?.sessionId||"").trim();
    if(!sessionId||!subSessions.selectSubSessionMessages(sessionId)) return {applied:false,reason:"not_sub_session"};
    return subSessions.applySubSessionLifecycleEvent(turn);
  }
  function applyTurnRuntimeEvent(event){
    const result=turnActions.applyTurnRuntimeEvent(event);
    const subSessionEffect=result?.applied===true?projectAppliedTurnRuntime(result.turn):null;
    return {...result,subSessionEffect};
  }
  function resetChatStore(){ input.value=""; uploadFiles.value=[]; turnRuntimeRegistry.value=createTurnRuntimeRegistryState(); workflowNodeStateRegistry.value=null; subSessionMessageRegistry.value=createSubSessionMessageRegistry(); subSessionMessageRegistryVersion.value+=1; sessions.value=[]; activeSessionId.value=""; loadingSessions.value=false; loadingSessionDetail.value=false; pendingInteractionRequest.value=null; pendingInteractionRequests.value=[]; interactionSubmitting.value=false; }
  return { input,uploadFiles,turnRuntimeRegistry,workflowNodeStateRegistry,subSessionMessageRegistry,subSessionMessageRegistryVersion,sessions,activeSessionId,activeSession,loadingSessions,loadingSessionDetail,pendingInteractionRequest,pendingInteractionRequests,interactionSubmitting,...turnActions,applyTurnRuntimeEvent,projectAppliedTurnRuntime,...workflows,selectSubSessionMessages:subSessions.selectSubSessionMessages,...executionSelectors,resetChatStore };
});
