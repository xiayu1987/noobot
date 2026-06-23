/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { onBeforeUnmount, onMounted, watch } from "vue";
import { ElMessage } from "element-plus";
import { useWorkflowNodeSessionLabels } from "./workflowNodeSessionLabels";
import { useWorkflowDrawerHistory } from "./workflowDrawerHistory";
import {
  fetchWorkflowNodeSessionDetail,
  fetchWorkflowNodeThinkingDetail,
} from "./workflowNodeSessionDetail";

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
  selectedGraphDialogId,
  applyingWorkflowDrawerHistory,
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

  async function fetchSelectedNodeThinkingDetail(_sessionId = "", { dialogProcessId = "", turnScopeId = "" } = {}) {
    const route = buildWorkflowDrawerRoute(selectedNode.value || {});
    return fetchWorkflowNodeThinkingDetail({
      props,
      translate,
      rootSessionId: route.rootSessionId,
      dialogId: route.dialogId,
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
  }

  function applySelectedNodeSessionDetail(detail = {}) {
    selectedNodeSessionSummary.value = detail.sessionSummary || null;
    selectedNodeSessionId.value = detail.sessionId || "";
    selectedNodeMessages.value = Array.isArray(detail.messages) ? detail.messages : [];
    selectedNodeRawMessages.value = Array.isArray(detail.rawMessages) ? detail.rawMessages : [];
  }

  async function openNodeSession(nodeItem = {}, options = {}) {
    const { fromHistory = false } = options || {};
    selectedGraphDialogId.value = String(nodeItem?.dialogId || "").trim();
    const { dialogId, rootSessionId } = buildWorkflowDrawerRoute(nodeItem);
    if (!props.userId || !rootSessionId || !dialogId) {
      ElMessage.warning(translate("workflow.nodeSessionMissing"));
      return;
    }
    viewerVisible.value = true;
    if (!fromHistory) {
      pushWorkflowDrawerHistory({ dialogId, rootSessionId });
    }
    viewerLoading.value = true;
    viewerError.value = "";
    selectedNode.value = nodeItem;
    resetSelectedNodeSession();
    try {
      const detail = await fetchWorkflowNodeSessionDetail({
        props,
        translate,
        rootSessionId,
        dialogId,
      });
      applySelectedNodeSessionDetail(detail);
    } catch (error) {
      viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
    } finally {
      viewerLoading.value = false;
    }
  }

  function openWorkflowNodePanel(nodeItem = {}) {
    selectedRuntimeNode.value = nodeItem;
    selectedRuntimeStep.value = null;
    selectedNode.value = nodeItem;
    selectedGraphDialogId.value = "";
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

  function handleSelectedDialogUpdate(dialogId = "") {
    selectedGraphDialogId.value = String(dialogId || "").trim();
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
    if (initialRoute.dialogId && initialRoute.rootSessionId) {
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
      replaceWorkflowDrawerHistory({ dialogId: "", rootSessionId: "" });
    },
  );

  return {
    handleOpenThinkingDetails,
    resolveStatusLabel,
    resolveStatusClass,
    resolveStepLabel,
    resolveStateBoxLabel,
    stepHasSession,
    openNodeSession,
    openWorkflowNodePanel,
    handleRuntimeStepClick,
    handleSelectedDialogUpdate,
  };
}
