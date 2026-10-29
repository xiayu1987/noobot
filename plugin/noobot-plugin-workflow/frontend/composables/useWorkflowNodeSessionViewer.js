/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { useWorkflowNodeSessionHistory } from "../runtime/workflowNodeSessionHistory.js";
import { useWorkflowNodeSessionLabels } from "../runtime/workflowNodeSessionLabels.js";
import { useWorkflowDrawerHistory } from "../services/workflowDrawerHistory.js";
import {
  fetchWorkflowNodeExecutionReport,
  fetchWorkflowNodeThinkingDetail,
} from "../runtime/workflowNodeSessionDetail.js";
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
import { text } from "@noobot/shared/value";
import { projectSessionMetadata } from "../runtime/workflowUnifiedSessionDetail.js";

export {
  isSameWorkflowDrawerRoute,
  resolveCanonicalWorkflowNodeItem,
  shouldRejectRootSessionProjection,
} from "../runtime/workflowNodeSessionIdentity.js";

function createViewerRefs(input) {
  return {
    ...input,
    selectedExecutionId: ref(""),
    executionDirectory: ref([]),
    attemptExecutionIds: ref([]),
  };
}

function createExecutionController({ props, refs, nodeViewTransaction }) {
  function applyExecutionDetail(executionId = "") {
    const id = text(executionId);
    if (!id) return false;
    const detail = props.selectExecutionDetail(id);
    if (!detail) return false;
    const { session } = detail;
    refs.selectedExecutionId.value = id;
    nodeViewTransaction.replace(nodeViewTransaction.ticket(), {
      sessionId: session.sessionId,
      messages: session.messages,
      sessionMetadata: { ...projectSessionMetadata(session), executionId: id },
    });
    return true;
  }

  function selectExecution(executionId = "") {
    refs.viewerError.value = "";
    if (applyExecutionDetail(executionId)) return true;
    refs.viewerError.value = `Execution not found: ${text(executionId)}`;
    return false;
  }

  return { selectExecution };
}

function createViewerCommands(context) {
  const { props, emit, refs, nodeViewTransaction, buildWorkflowDrawerRoute, stepHasSession } =
    context;
  async function fetchSelectedNodeThinkingDetail({ dialogProcessId, turnScopeId }) {
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

  async function fetchSelectedNodeExecutionReport({ dialogProcessId = "" } = {}) {
    const route = buildWorkflowDrawerRoute(refs.selectedNode.value || {});
    return fetchWorkflowNodeExecutionReport({
      props,
      translate: context.translate,
      rootSessionId: route.rootSessionId,
      routeDialogProcessId: route.dialogProcessId,
      dialogProcessId,
    });
  }

  function handleOpenThinkingDetails(payload = {}) {
    emit("open-thinking-details", {
      ...(payload && typeof payload === "object" ? payload : {}),
      fetchThinkingDetail: fetchSelectedNodeThinkingDetail,
    });
  }

  function openWorkflowNodePanel(nodeItem) {
    refs.selectedRuntimeNode.value = nodeItem;
    refs.selectedRuntimeStep.value = null;
    refs.selectedNode.value = nodeItem;
    refs.selectedGraphDialogProcessId.value = "";
    nodeViewTransaction.invalidate();
    refs.viewerError.value = "";
    refs.viewerState.value = "idle";
    refs.viewerVisible.value = true;
    props.logWorkflowDiagnostics("frontend.workflowNodeDetail.nodePanelOpened", {
      nodeSessionId: text(nodeItem.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(nodeItem),
      turnScopeId: text(nodeItem.turnScopeId),
      workflowRunId: text(nodeItem.workflowRunId),
      nodeExecutionId: text(nodeItem.nodeExecutionId),
    });
  }

  async function handleRuntimeStepClick(stepItem = {}) {
    const traceId = createWorkflowNodeDetailTraceId();
    props.logWorkflowDiagnostics("frontend.workflowNodeDetail.stepClicked", {
      traceId,
      nodeSessionId: text(stepItem.nodeSessionId),
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
    fetchSelectedNodeExecutionReport,
    handleOpenThinkingDetails,
    openWorkflowNodePanel,
    handleRuntimeStepClick,
    handleSelectedDialogProcessUpdate,
  };
}

export function useWorkflowNodeSessionViewer(input) {
  const { props, emit, translate, flowNodes, runtimeNodeSessions, applyWorkflowRuntimeEvent } =
    input;
  const refs = createViewerRefs(input);
  const labels = useWorkflowNodeSessionLabels(translate);
  const history = useWorkflowDrawerHistory({ flowNodes });
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
    runtimeNodeSessions,
    nodeViewTransaction,
    refs,
  });
  const context = {
    props,
    emit,
    translate,
    flowNodes,
    runtimeNodeSessions,
    applyWorkflowRuntimeEvent,
    refs,
    nodeViewTransaction,
    buildWorkflowDrawerRoute: history.buildWorkflowDrawerRoute,
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
    nodeViewTransaction,
    buildWorkflowDrawerRoute: history.buildWorkflowDrawerRoute,
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
