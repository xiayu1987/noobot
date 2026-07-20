/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { ElMessage } from "element-plus";
import { useWorkflowNodeSessionLabels } from "./workflowNodeSessionLabels";
import { useWorkflowDrawerHistory } from "./workflowDrawerHistory";
import {
  fetchWorkflowNodeSessionDetail,
  fetchWorkflowNodeThinkingDetail,
} from "./workflowNodeSessionDetail";
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";
import {
  buildUnifiedSessionDetail,
  hasNewProtocolNodeIdentity,
} from "./workflowUnifiedSessionDetail.js";

function text(value) {
  return String(value || "").trim();
}

export function useWorkflowNodeSessionViewer({
  props,
  emit,
  translate,
  workflowPayload,
  flowNodes,
  viewerVisible,
  viewerLoading,
  viewerError,
  selectedNode,
  selectedRuntimeNode,
  selectedRuntimeStep,
  selectedNodeMessages,
  selectedNodeRawMessages,
  selectedNodeSessionSummary,
  selectedNodeSessionId,
  selectedGraphDialogProcessId,
  runtimeNodeSessions,
  applyingWorkflowDrawerHistory,
  mergeSubSessionSnapshot,
}) {
  const {
    resolveStatusLabel,
    resolveStatusClass,
    resolveStepLabel,
    resolveStateBoxLabel,
    stepHasSession,
  } = useWorkflowNodeSessionLabels(translate);

  const {
    buildWorkflowDrawerRoute,
    pushWorkflowDrawerHistory,
    replaceWorkflowDrawerHistory,
    parseWorkflowDrawerRoute,
    findWorkflowSessionTarget,
  } = useWorkflowDrawerHistory({
    workflowPayload,
    flowNodes,
    applyingWorkflowDrawerHistory,
  });
  let nodeSessionRequestToken = 0;
  const selectedExecutionId = ref("");
  const executionDirectory = ref([]);
  const attemptExecutionIds = ref([]);

  function applyExecutionDetail(executionId = "") {
    const id = text(executionId);
    if (!id || typeof props.selectExecutionDetail !== "function") return false;
    const detail = props.selectExecutionDetail(id);
    if (!detail) return false;
    const execution = detail.execution || {};
    const session = detail.session || {};
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    selectedExecutionId.value = id;
    applySelectedNodeSessionDetail({
      sessionId: text(execution.sessionId || session.sessionId || session.id),
      messages,
      rawMessages: messages,
      sessionSummary: {
        ...session,
        executionId: id,
        turnRuntime: execution,
        messages,
      },
    });
    return true;
  }

  function selectExecution(executionId = "") {
    viewerError.value = "";
    if (applyExecutionDetail(executionId)) return true;
    viewerError.value = `Execution not found: ${text(executionId)}`;
    return false;
  }

  async function fetchSelectedNodeThinkingDetail(_sessionId = "", { dialogProcessId = "", turnScopeId = "" } = {}) {
    const route = buildWorkflowDrawerRoute(selectedNode.value || {});
    return fetchWorkflowNodeThinkingDetail({
      props,
      translate,
      rootSessionId: route.rootSessionId,
      routeDialogProcessId: route.dialogProcessId,
      dialogProcessId,
      turnScopeId,
    });
  }

  function handleOpenThinkingDetails(payload = {}) {
    emit("open-thinking-details", {
      ...(payload && typeof payload === "object" ? payload : {}),
      forceFetch: true,
      fetchThinkingDetail: fetchSelectedNodeThinkingDetail,
    });
  }

  function resetSelectedNodeSession() {
    selectedNodeMessages.value = [];
    selectedNodeRawMessages.value = [];
    selectedNodeSessionSummary.value = null;
    selectedNodeSessionId.value = "";
    selectedExecutionId.value = "";
    executionDirectory.value = [];
    attemptExecutionIds.value = [];
  }

  function applySelectedNodeSessionDetail(detail = {}) {
    selectedNodeSessionSummary.value = detail.sessionSummary || null;
    selectedNodeSessionId.value = detail.sessionId || "";
    selectedNodeMessages.value = Array.isArray(detail.messages) ? detail.messages : [];
    selectedNodeRawMessages.value = Array.isArray(detail.rawMessages) ? detail.rawMessages : [];
    if (typeof mergeSubSessionSnapshot === "function") {
      mergeSubSessionSnapshot({
        ...detail.sessionSummary,
        sessionId: detail.sessionId || detail.sessionSummary?.sessionId || "",
        messages: Array.isArray(detail.messages) ? detail.messages : [],
      });
    }
  }

  function applyUnifiedSessionDetailIfAvailable(nodeItem = selectedNode.value || {}) {
    if (!viewerVisible.value || !selectedNode.value) return false;
    const detail = buildUnifiedSessionDetail({
      nodeItem,
      runtimeNodeSessions,
      selectSessionMessages: props.selectSessionMessages,
      selectExecutionDetail: props.selectExecutionDetail,
      turnRuntimeRegistry: props.turnRuntimeRegistry,
      allowEmptyMessages: false,
    });
    if (!detail) return false;
    applySelectedNodeSessionDetail(detail);
    selectedExecutionId.value = text(detail.executionId);
    attemptExecutionIds.value = Array.isArray(detail.attemptExecutionIds) ? detail.attemptExecutionIds : [];
    executionDirectory.value = [
      ...(detail.execution ? [detail.execution] : []),
      ...(Array.isArray(detail.descendantExecutions) ? detail.descendantExecutions : []),
    ].filter((item, index, values) => {
      const id = text(item?.executionId);
      return id && values.findIndex((candidate) => text(candidate?.executionId) === id) === index;
    });
    return true;
  }

  function bindSelectedNodeRealtimeProjection(nodeItem = selectedNode.value || {}) {
    const sessionId = text(
      nodeItem?.sessionId ||
      nodeItem?.nodeSessionId ||
      selectedNodeSessionId.value,
    );
    if (!sessionId || typeof props.selectSessionMessages !== "function") return false;
    const sessionDoc = props.selectSessionMessages(sessionId);
    if (!sessionDoc || typeof sessionDoc !== "object") return false;
    selectedNodeSessionId.value = sessionId;
    selectedNodeSessionSummary.value = sessionDoc;
    selectedNodeMessages.value = Array.isArray(sessionDoc.messages) ? sessionDoc.messages : [];
    selectedNodeRawMessages.value = Array.isArray(sessionDoc.rawMessages)
      ? sessionDoc.rawMessages
      : selectedNodeMessages.value;
    return true;
  }

  async function openNodeSession(nodeItem = {}, options = {}) {
    const { fromHistory = false } = options || {};
    const requestToken = ++nodeSessionRequestToken;
    selectedGraphDialogProcessId.value = resolveWorkflowDialogProcessId(nodeItem);
    const { dialogProcessId, rootSessionId } = buildWorkflowDrawerRoute(nodeItem);
    const isNewProtocolNode = hasNewProtocolNodeIdentity(nodeItem);
    if (!props.userId || (!isNewProtocolNode && (!rootSessionId || !dialogProcessId))) {
      ElMessage.warning(translate("workflow.nodeSessionMissing"));
      return;
    }
    viewerVisible.value = true;
    if (!fromHistory && rootSessionId && dialogProcessId) {
      pushWorkflowDrawerHistory({ dialogProcessId, rootSessionId });
    }
    viewerLoading.value = true;
    viewerError.value = "";
    selectedNode.value = nodeItem;
    resetSelectedNodeSession();
    bindSelectedNodeRealtimeProjection(nodeItem);
    if (isNewProtocolNode) {
      applyUnifiedSessionDetailIfAvailable(nodeItem);
      viewerLoading.value = false;
      return;
    }
    if (!rootSessionId || !dialogProcessId) {
      viewerLoading.value = false;
      return;
    }
    try {
      const detail = await fetchWorkflowNodeSessionDetail({
        props,
        translate,
        rootSessionId,
        dialogProcessId,
      });
      if (requestToken !== nodeSessionRequestToken) return;
      applySelectedNodeSessionDetail(detail);
      applyUnifiedSessionDetailIfAvailable(nodeItem);
    } catch (error) {
      if (requestToken !== nodeSessionRequestToken) return;
      viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
    } finally {
      if (requestToken === nodeSessionRequestToken) {
        viewerLoading.value = false;
      }
    }
  }

  function openWorkflowNodePanel(nodeItem = {}) {
    nodeSessionRequestToken += 1;
    selectedRuntimeNode.value = nodeItem;
    selectedRuntimeStep.value = null;
    selectedNode.value = nodeItem;
    selectedGraphDialogProcessId.value = "";
    resetSelectedNodeSession();
    viewerError.value = "";
    viewerLoading.value = false;
    viewerVisible.value = true;
  }

  async function handleRuntimeStepClick(stepItem = {}) {
    if (!stepHasSession(stepItem)) return;
    selectedRuntimeStep.value = stepItem;
    await openNodeSession(stepItem);
  }

  function handleSelectedDialogProcessUpdate(dialogProcessId = "") {
    selectedGraphDialogProcessId.value = String(dialogProcessId || "").trim();
  }

  async function applyWorkflowDrawerRoute(route = {}) {
    const target = findWorkflowSessionTarget(route);
    applyingWorkflowDrawerHistory.value = true;
    try {
      if (target) {
        await openNodeSession(target, { fromHistory: true });
        return;
      }
      viewerVisible.value = false;
    } finally {
      applyingWorkflowDrawerHistory.value = false;
    }
  }

  async function handleWorkflowDrawerPopState(event) {
    await applyWorkflowDrawerRoute(parseWorkflowDrawerRoute(event?.state));
  }

  onMounted(() => {
    window.addEventListener("popstate", handleWorkflowDrawerPopState);
    const initialRoute = parseWorkflowDrawerRoute(history.state);
    if (initialRoute.dialogProcessId && initialRoute.rootSessionId) {
      applyWorkflowDrawerRoute(initialRoute);
    }
  });

  onBeforeUnmount(() => {
    window.removeEventListener("popstate", handleWorkflowDrawerPopState);
  });

  watch(
    () => viewerVisible.value,
    (visible) => {
      if (visible || applyingWorkflowDrawerHistory.value) return;
      selectedRuntimeNode.value = null;
      selectedRuntimeStep.value = null;
      replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
    },
  );

  watchEffect(() => {
    if (!viewerVisible.value || !selectedNode.value) return;
    if (!applyUnifiedSessionDetailIfAvailable(selectedNode.value)) {
      bindSelectedNodeRealtimeProjection(selectedNode.value);
    }
  });

  return {
    selectedExecutionId,
    executionDirectory,
    attemptExecutionIds,
    selectExecution,
    handleOpenThinkingDetails,
    resolveStatusLabel,
    resolveStatusClass,
    resolveStepLabel,
    resolveStateBoxLabel,
    stepHasSession,
    openNodeSession,
    openWorkflowNodePanel,
    handleRuntimeStepClick,
    handleSelectedDialogProcessUpdate,
  };
}
