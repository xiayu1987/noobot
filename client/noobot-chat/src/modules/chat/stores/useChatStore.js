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
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import { projectTurnRuntimeToMessages } from "../runtime/engine/turnProjectionStore.js";
import { isFinalTurnState } from "../runtime/run-state-machine/turnReducer.js";

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
  const activeSession=computed(()=>sessions.value.find(item=>item.sessionId===activeSessionId.value));
  let subSessions=null;
  function closePendingInteractionsForTerminalTurn(turn={}){
    if(!isFinalTurnState(turn?.state,turn)) return 0;
    const sessionId=String(turn?.sessionId||"").trim();
    const dialogProcessId=String(turn?.dialogProcessId||"").trim();
    const turnScopeId=String(turn?.turnScopeId||"").trim();
    if(!sessionId||!turnScopeId) return 0;
    const before=pendingInteractionRequests.value.length;
    pendingInteractionRequests.value=pendingInteractionRequests.value.filter((request={})=>{
      if(String(request?.sessionId||"").trim()!==sessionId) return true;
      const requestDialogProcessId=String(request?.dialogProcessId||"").trim();
      if(dialogProcessId&&requestDialogProcessId!==dialogProcessId) return true;
      const requestTurnScopeId=String(request?.turnScopeId||"").trim();
      return requestTurnScopeId!==turnScopeId;
    });
    const activeId=String(activeSessionId.value||"").trim();
    pendingInteractionRequest.value=pendingInteractionRequests.value.find(
      (request={})=>String(request?.sessionId||"").trim()===activeId,
    )||null;
    if(!pendingInteractionRequest.value) interactionSubmitting.value=false;
    return before-pendingInteractionRequests.value.length;
  }
  const turnActions=createTurnRuntimeStoreActions(turnRuntimeRegistry, {
    onTurnEvaluated:({reducer,input,result,applied})=>{
      const turn=result?.turn;
      logWorkflowDiagnostics("frontend.turnRuntime.commitEvaluated",()=>({
        sessionId:String(turn?.parentSessionId||input?.parentSessionId||turn?.sessionId||input?.sessionId||"").trim(),
        nodeSessionId:String(turn?.sessionId||input?.sessionId||"").trim(),
        parentSessionId:String(turn?.parentSessionId||input?.parentSessionId||"").trim(),
        dialogProcessId:String(turn?.dialogProcessId||input?.dialogProcessId||"").trim(),
        turnScopeId:String(turn?.turnScopeId||input?.turnScopeId||"").trim(),
        reducer,
        eventType:String(input?.eventType||input?.type||"").trim(),
        applied,
        reason:String(result?.reason||"").trim(),
        state:String(turn?.state||"").trim(),
        terminal:String(turn?.terminal||"").trim(),
      }));
    },
    onTurnCommitted:(result)=>{
      const turn=result?.turn;
      closePendingInteractionsForTerminalTurn(turn);
      const sessionId=String(turn?.sessionId||"").trim();
      const parentSessionId=String(turn?.parentSessionId||"").trim();
      const existingSubSession=Boolean(sessionId&&subSessions?.selectSubSessionMessages(sessionId));
      logWorkflowDiagnostics("frontend.turnRuntime.commitProjectionEvaluated",()=>({
        sessionId:parentSessionId||sessionId,
        nodeSessionId:sessionId,
        parentSessionId,
        dialogProcessId:String(turn?.dialogProcessId||"").trim(),
        turnScopeId:String(turn?.turnScopeId||"").trim(),
        state:String(turn?.state||"").trim(),
        terminal:String(turn?.terminal||"").trim(),
        applied:result?.applied===true,
        existingSubSession,
        projectionEligible:Boolean(sessionId&&subSessions&&(existingSubSession||parentSessionId)),
      }));
      const mainSessionProjection=projectTurnRuntimeToMessages({
        sessions,
        activeSession,
        turnRuntimeRegistry,
        turn,
      });
      let container={applied:false,reason:"not_sub_session"};
      let subSessionProjection={applied:false,patchedMessageCount:0,reason:"not_sub_session"};
      if(sessionId&&subSessions&&(existingSubSession||parentSessionId)){
        container=subSessions.ensureSubSessionMessageContainer(turn);
        subSessionProjection=subSessions.applyTurnRuntimeMessageProjection(turn);
      }
      logWorkflowDiagnostics("frontend.turnRuntime.messageProjectionCommitted",()=>({
        sessionId:parentSessionId||sessionId,
        nodeSessionId:sessionId,
        parentSessionId,
        dialogProcessId:String(turn?.dialogProcessId||"").trim(),
        turnScopeId:String(turn?.turnScopeId||"").trim(),
        messageId:String(turn?.messageId||"").trim(),
        presentationMessageId:String(turn?.presentationMessageId||"").trim(),
        state:String(turn?.state||"").trim(),
        terminal:String(turn?.terminal||"").trim(),
        mainSessionProjectionReason:String(mainSessionProjection?.reason||"").trim(),
        mainSessionPatchedMessageCount:Number(mainSessionProjection?.patchedMessageCount||0),
        subSessionProjectionReason:String(subSessionProjection?.reason||"").trim(),
        subSessionPatchedMessageCount:Number(subSessionProjection?.patchedMessageCount||0),
      }));
      return {container,mainSessionProjection,subSessionProjection};
    },
  });
  subSessions=createSubSessionStore({
    subSessionMessageRegistry,
    subSessionMessageRegistryVersion,
    turnRuntimeRegistry,
    // Resolve lazily: workflowStore is created below because it depends on
    // the sub-session reducers. This keeps one selector implementation while
    // avoiding a second workflow-state cache in the sub-session store.
    selectWorkflowNodeState: (...args) => workflows.selectWorkflowNodeState(...args),
    applyTurnTimingSnapshot:turnActions.applyTurnTimingSnapshot,
  });
  const workflows=createWorkflowStore({
    workflowNodeStateRegistry,
    ensureSubSessionMessageContainer:subSessions.ensureSubSessionMessageContainer,
    reduceSubSessionMessageEvent:subSessions.reduceSubSessionMessageEvent,
    reduceSubSessionSnapshot:subSessions.reduceSubSessionSnapshot,
    removeSubSessionsByWorkflowRunIds:subSessions.removeSubSessionsByWorkflowRunIds,
    selectSubSessionMessages:subSessions.selectSubSessionMessages,
  });
  const executionSelectors=createChatExecutionSelectors({turnRuntimeRegistry,sessions,selectSubSessionMessages:subSessions.selectSubSessionMessages});
  function resetChatStore(){ input.value=""; uploadFiles.value=[]; turnRuntimeRegistry.value=createTurnRuntimeRegistryState(); workflowNodeStateRegistry.value=null; subSessionMessageRegistry.value=createSubSessionMessageRegistry(); subSessionMessageRegistryVersion.value+=1; sessions.value=[]; activeSessionId.value=""; loadingSessions.value=false; loadingSessionDetail.value=false; pendingInteractionRequest.value=null; pendingInteractionRequests.value=[]; interactionSubmitting.value=false; }
  return { input,uploadFiles,turnRuntimeRegistry,workflowNodeStateRegistry,subSessionMessageRegistry,subSessionMessageRegistryVersion,sessions,activeSessionId,activeSession,loadingSessions,loadingSessionDetail,pendingInteractionRequest,pendingInteractionRequests,interactionSubmitting,...turnActions,...workflows,selectSubSessionMessages:subSessions.selectSubSessionMessages,selectSubSessionTurnRuntime:subSessions.selectSubSessionTurnRuntime,selectSubSessionTiming:subSessions.selectSubSessionTiming,...executionSelectors,resetChatStore };
});
