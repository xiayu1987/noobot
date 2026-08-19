/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { useWorkflowNodeSessionHistory } from "../runtime/workflowNodeSessionHistory.js";
import { useWorkflowNodeSessionLabels } from "../runtime/workflowNodeSessionLabels.js";
import { useWorkflowDrawerHistory } from "../services/workflowDrawerHistory.js";
import { fetchWorkflowNodeThinkingDetail } from "../runtime/workflowNodeSessionDetail.js";
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { createWorkflowNodeViewTransaction } from "../runtime/workflowNodeViewTransaction.js";
import {
  createWorkflowNodeDetailTraceId,
  summarizeWorkflowNodeIdentity,
} from "../runtime/workflowNodeSessionDiagnostics.js";
import { createSessionSnapshotController } from "./workflow-node-session-viewer/snapshot-controller.js";
import { watchRuntimeNodeRebound } from "./workflow-node-session-viewer/runtime-rebound.js";
import { createLiveProjectionController } from "./workflow-node-session-viewer/live-projection-controller.js";
import { createNodeSessionOpeningController } from "./workflow-node-session-viewer/node-session-opening.js";

export {
  isSameWorkflowDrawerRoute,
  resolveCanonicalWorkflowNodeItem,
  shouldRejectRootSessionProjection,
} from "../runtime/workflowNodeSessionIdentity.js";

const text = (value) => String(value || "").trim();

function createViewerRefs(input) {
  return {
    ...input,
    selectedExecutionId: ref(""),
    executionDirectory: ref([]),
    attemptExecutionIds: ref([]),
  };
}

function createExecutionController({ props, refs, nodeViewTransaction }) {
  function resolveLocalExecution(executionId = "", sessionIdHint = "") {
    const detail =
      typeof props.selectExecutionDetail === "function"
        ? props.selectExecutionDetail(executionId)
        : null;
    return {
      detail,
      sessionId: text(
        detail?.execution?.sessionId ||
          detail?.session?.sessionId ||
          detail?.session?.id ||
          sessionIdHint,
      ),
    };
  }

  function applyExecutionDetail(executionId = "") {
    const id = text(executionId);
    if (!id || typeof props.selectExecutionDetail !== "function") return false;
    const detail = props.selectExecutionDetail(id);
    if (!detail) return false;
    const execution = detail.execution || {};
    const session = detail.session || {};
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    refs.selectedExecutionId.value = id;
    nodeViewTransaction.replace(nodeViewTransaction.ticket(), {
      sessionId: text(execution.sessionId || session.sessionId || session.id),
      messages,
      rawMessages: messages,
      sessionSummary: { ...session, executionId: id, messages },
    });
    return true;
  }

  function resolveExecutionSessionId(executionId = "", sessionIdHint = "") {
    const id = text(executionId);
    if (!id) return text(sessionIdHint);
    return resolveLocalExecution(id, sessionIdHint).sessionId;
  }

  function selectExecution(executionId = "") {
    refs.viewerError.value = "";
    if (applyExecutionDetail(executionId)) return true;
    refs.viewerError.value = `Execution not found: ${text(executionId)}`;
    return false;
  }

  return { resolveExecutionSessionId, selectExecution };
}

function createViewerCommands(context) {
  const { props, emit, refs, nodeViewTransaction, buildWorkflowDrawerRoute, stepHasSession } =
    context;
  async function fetchSelectedNodeThinkingDetail(
    _sessionId = "",
    { dialogProcessId = "", turnScopeId = "" } = {},
  ) {
    const route = buildWorkflowDrawerRoute(refs.selectedNode.value || {});
    return fetchWorkflowNodeThinkingDetail({
      props,
      translate: context.translate,
      rootSessionId: route.rootSessionId,
      routeDialogProcessId: route.dialogProcessId,
      dialogProcessId,
      turnScopeId,
    });
  }

  function handleOpenThinkingDetails(payload = {}) {
    emit("open-thinking-details", {
      ...(payload && typeof payload === "object" ? payload : {}),
      fetchThinkingDetail: fetchSelectedNodeThinkingDetail,
    });
  }

  function openWorkflowNodePanel(nodeItem = {}) {
    refs.selectedRuntimeNode.value = nodeItem;
    refs.selectedRuntimeStep.value = null;
    refs.selectedNode.value = nodeItem;
    refs.selectedGraphDialogProcessId.value = "";
    nodeViewTransaction.invalidate();
    refs.viewerError.value = "";
    refs.viewerState.value = "idle";
    refs.viewerVisible.value = true;
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.nodePanelOpened", {
      sessionId: text(nodeItem.sessionId || nodeItem.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(nodeItem),
      turnScopeId: text(nodeItem.turnScopeId),
      workflowRunId: text(nodeItem.workflowRunId),
      nodeExecutionId: text(nodeItem.nodeExecutionId),
    });
  }

  async function handleRuntimeStepClick(stepItem = {}) {
    const traceId = createWorkflowNodeDetailTraceId();
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.stepClicked", {
      traceId,
      sessionId: text(stepItem.sessionId || stepItem.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(stepItem),
      turnScopeId: text(stepItem.turnScopeId),
      workflowRunId: text(stepItem.workflowRunId),
      nodeExecutionId: text(stepItem.nodeExecutionId),
      stepHasSession: stepHasSession(stepItem),
      renderedIdentity: summarizeWorkflowNodeIdentity(stepItem),
    });
    if (stepHasSession(stepItem)) await context.openNodeSession(stepItem, { traceId });
  }

  function handleSelectedDialogProcessUpdate(dialogProcessId = "") {
    refs.selectedGraphDialogProcessId.value = text(dialogProcessId);
  }

  return {
    handleOpenThinkingDetails,
    openWorkflowNodePanel,
    handleRuntimeStepClick,
    handleSelectedDialogProcessUpdate,
  };
}

export function useWorkflowNodeSessionViewer(input) {
  const {
    props,
    emit,
    translate,
    workflowPayload,
    flowNodes,
    runtimeNodeSessions,
    applyingWorkflowDrawerHistory,
    applyWorkflowRuntimeEvent,
  } = input;
  const refs = createViewerRefs(input);
  const labels = useWorkflowNodeSessionLabels(translate);
  const history = useWorkflowDrawerHistory({
    workflowPayload,
    flowNodes,
    applyingWorkflowDrawerHistory,
  });
  const snapshotCallbacks = { controller: null };
  const nodeViewTransaction = createWorkflowNodeViewTransaction({
    clearSnapshot: () => snapshotCallbacks.controller.reset(),
    replaceSnapshot: (detail) => snapshotCallbacks.controller.replace(detail),
    mergeSnapshot: (detail) => snapshotCallbacks.controller.merge(detail),
  });
  snapshotCallbacks.controller = createSessionSnapshotController({
    props,
    refs,
    buildWorkflowDrawerRoute: history.buildWorkflowDrawerRoute,
  });
  watch(
    () => nodeViewTransaction.state.phase,
    (phase) => {
      refs.viewerLoading.value = phase === "loading";
    },
    { immediate: true, flush: "sync" },
  );
  watchRuntimeNodeRebound({ props, flowNodes, refs });
  const execution = createExecutionController({
    props,
    refs,
    nodeViewTransaction,
  });
  const liveProjection = createLiveProjectionController({
    props,
    workflowPayload,
    runtimeNodeSessions,
    nodeViewTransaction,
    refs,
  });
  const context = {
    props,
    emit,
    translate,
    workflowPayload,
    flowNodes,
    runtimeNodeSessions,
    applyWorkflowRuntimeEvent,
    refs,
    nodeViewTransaction,
    buildWorkflowDrawerRoute: history.buildWorkflowDrawerRoute,
    pushWorkflowDrawerHistory: history.pushWorkflowDrawerHistory,
    resolveExecutionSessionId: execution.resolveExecutionSessionId,
    applyUnifiedSessionDetailIfAvailable: liveProjection.applyAvailable,
    stepHasSession: labels.stepHasSession,
  };
  context.openNodeSession = createNodeSessionOpeningController(context);
  const commands = createViewerCommands(context);
  useWorkflowNodeSessionHistory({
    props,
    flowNodes,
    viewerVisible: refs.viewerVisible,
    selectedNode: refs.selectedNode,
    selectedRuntimeNode: refs.selectedRuntimeNode,
    selectedRuntimeStep: refs.selectedRuntimeStep,
    applyingWorkflowDrawerHistory,
    nodeViewTransaction,
    buildWorkflowDrawerRoute: history.buildWorkflowDrawerRoute,
    replaceWorkflowDrawerHistory: history.replaceWorkflowDrawerHistory,
    parseWorkflowDrawerRoute: history.parseWorkflowDrawerRoute,
    findWorkflowSessionTarget: history.findWorkflowSessionTarget,
    openNodeSession: context.openNodeSession,
  });
  liveProjection.watchProjection();
  return {
    selectedExecutionId: refs.selectedExecutionId,
    executionDirectory: refs.executionDirectory,
    attemptExecutionIds: refs.attemptExecutionIds,
    selectExecution: execution.selectExecution,
    ...commands,
    ...labels,
    openNodeSession: context.openNodeSession,
  };
}
