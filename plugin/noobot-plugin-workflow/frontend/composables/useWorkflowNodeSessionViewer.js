/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  createWorkflowNodeDetailTraceId,
  logWorkflowNodeDetailProjection,
  summarizeWorkflowNodeIdentity,
} from "../runtime/workflowNodeSessionDiagnostics.js";

const text = (value) => String(value || "").trim();
import {
  createWorkflowNodeViewKey,
  findCurrentWorkflowRuntimeNode,
  findCurrentWorkflowRuntimeStep,
  findWorkflowOwningRuntimeNode,
  resolveWorkflowDetailSessionId,
} from "../runtime/workflowNodeSessionRuntime.js";
import {
  resolveCanonicalWorkflowNodeItem,
  shouldRejectRootSessionProjection,
} from "../runtime/workflowNodeSessionIdentity.js";
export {
  isSameWorkflowDrawerRoute,
  resolveCanonicalWorkflowNodeItem,
  shouldRejectRootSessionProjection,
} from "../runtime/workflowNodeSessionIdentity.js";
import { useWorkflowNodeSessionHistory } from "../runtime/workflowNodeSessionHistory.js";
import { useWorkflowNodeSessionLabels } from "../runtime/workflowNodeSessionLabels.js";
import { useWorkflowDrawerHistory } from "../services/workflowDrawerHistory.js";
import {
  fetchExecutionSessionDetail,
  fetchWorkflowNodeSessionDetail,
  fetchWorkflowNodeThinkingDetail,
  hydrateExecutionSessionDetail,
} from "../runtime/workflowNodeSessionDetail.js";
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessIdCompat.js";
import { createWorkflowNodeViewTransaction } from "../runtime/workflowNodeViewTransaction.js";
import {
  buildUnifiedSessionDetail,
  hasNewProtocolNodeIdentity,
  mergeUnifiedSessionDetail,
  projectTurnStatusOntoAssistant,
  resolveIsolatedNodeSessionId,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
  createRunningAssistantPlaceholderViewModel,
} from "../runtime/workflowUnifiedSessionDetail.js";

export function useWorkflowNodeSessionViewer({
  props,
  emit,
  translate,
  workflowPayload,
  flowNodes,
  viewerVisible,
  viewerLoading,
  viewerError,
  viewerState,
  selectedNode,
  selectedRuntimeNode,
  selectedRuntimeStep,
  selectedNodeMessages,
  selectedNodeRawMessages,
  selectedNodeSessionSummary,
  selectedNodeSessionId,
  runningPlaceholderViewModel,
  selectedGraphDialogProcessId,
  runtimeNodeSessions,
  applyingWorkflowDrawerHistory,
  applyWorkflowRuntimeEvent,
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
  const selectedExecutionId = ref("");
  const executionDirectory = ref([]);
  const attemptExecutionIds = ref([]);
  const nodeViewTransaction = createWorkflowNodeViewTransaction({
    clearSnapshot: resetSelectedNodeSession,
    replaceSnapshot: replaceSelectedNodeSessionSnapshot,
    mergeSnapshot: mergeSelectedNodeSessionSnapshot,
  });
  watch(
    () => nodeViewTransaction.state.phase,
    (phase) => { viewerLoading.value = phase === "loading"; },
    { immediate: true, flush: "sync" },
  );

  watch(
    () => flowNodes?.value,
    () => {
      const previous = selectedRuntimeNode.value;
      if (!previous) return;
      const current = findCurrentWorkflowRuntimeNode(previous, flowNodes?.value);
      if (!current || current === previous) return;
      selectedRuntimeNode.value = current;
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeNodeRebound", {
        sessionId: text(
          selectedNodeSessionId.value ||
          current?.sessionId ||
          current?.nodeSessionId ||
          previous?.sessionId ||
          previous?.nodeSessionId,
        ),
        dialogProcessId: resolveWorkflowDialogProcessId(current),
        turnScopeId: text(current?.turnScopeId),
        workflowRunId: text(current?.workflowRunId),
        nodeExecutionId: text(current?.nodeExecutionId),
        nodeId: text(current?.nodeId),
        boxCount: Array.isArray(current?.actionNodeStates) ? current.actionNodeStates.length : 0,
        reason: "runtime_projection_updated",
      });
      const previousStep = selectedRuntimeStep.value;
      const currentStep = findCurrentWorkflowRuntimeStep(previousStep, current);
      if (previousStep && currentStep && currentStep !== previousStep) {
        selectedRuntimeStep.value = currentStep;
        selectedNode.value = currentStep;
        props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.runtimeStepRebound", {
          sessionId: text(currentStep?.sessionId || currentStep?.nodeSessionId),
          dialogProcessId: resolveWorkflowDialogProcessId(currentStep),
          turnScopeId: text(currentStep?.turnScopeId),
          workflowRunId: text(currentStep?.workflowRunId),
          nodeExecutionId: text(currentStep?.nodeExecutionId),
          stepId: text(currentStep?.stepId),
          previousStatus: text(previousStep?.status || previousStep?.state),
          currentStatus: text(currentStep?.status || currentStep?.state),
          reason: "runtime_projection_updated",
        });
      }
    },
    { flush: "sync" },
  );

  function isCurrentSessionRequest(viewTicket, targetSessionId = "", detail = null) {
    if (!nodeViewTransaction.accepts(viewTicket)) return false;
    const expectedSessionId = text(targetSessionId);
    const responseSessionId = resolveWorkflowDetailSessionId(detail || {});
    if (expectedSessionId && responseSessionId && expectedSessionId !== responseSessionId) return false;
    return true;
  }

  function applyExecutionDetail(executionId = "") {
    const id = text(executionId);
    if (!id || typeof props.selectExecutionDetail !== "function") return false;
    const detail = props.selectExecutionDetail(id);
    if (!detail) return false;
    const execution = detail.execution || {};
    const session = detail.session || {};
    const messages = Array.isArray(detail.messages) ? detail.messages : [];
    selectedExecutionId.value = id;
    nodeViewTransaction.replace(nodeViewTransaction.ticket(), {
      sessionId: text(execution.sessionId || session.sessionId || session.id),
      messages,
      rawMessages: messages,
      sessionSummary: {
        ...session,
        executionId: id,
        messages,
      },
    });
    return true;
  }

  async function loadExecutionSessionDetail(
    executionId = "",
    viewTicket = nodeViewTransaction.ticket(),
    { sessionIdHint = "" } = {},
  ) {
    const id = text(executionId);
    const localDetail = typeof props.selectExecutionDetail === "function"
      ? props.selectExecutionDetail(id)
      : null;
    const sessionId = text(
      localDetail?.execution?.sessionId ||
      localDetail?.session?.sessionId ||
      localDetail?.session?.id ||
      sessionIdHint,
    );
    if (!id) return { state: "failed", reason: "missing_execution_id" };
    if (!sessionId) return { state: "pending", reason: "session_identity_pending" };
    const route = buildWorkflowDrawerRoute(selectedNode.value || {});
    const detail = await fetchExecutionSessionDetail({
      props,
      translate,
      sessionId,
      rootSessionId: route.rootSessionId,
      dialogProcessId: route.dialogProcessId,
    });
    if (!isCurrentSessionRequest(viewTicket, sessionId, detail)) return { state: "stale" };
    if (detail?.state === "pending") return detail;
    nodeViewTransaction.replace(viewTicket, hydrateExecutionSessionDetail(detail, {
      executionId: id,
      execution: localDetail?.execution || null,
    }));
    selectedExecutionId.value = id;
    return { state: detail?.state === "empty" ? "empty" : "ready" };
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
    runningPlaceholderViewModel.value = null;
    selectedExecutionId.value = "";
    executionDirectory.value = [];
    attemptExecutionIds.value = [];
    viewerState.value = "idle";
  }

  function replaceSelectedNodeSessionSnapshot(detail = {}) {
    const normalizedDetail = mergeUnifiedSessionDetail({}, detail);
    selectedNodeSessionSummary.value = normalizedDetail.sessionSummary || null;
    selectedNodeSessionId.value = normalizedDetail.sessionId || "";
    selectedNodeMessages.value = normalizedDetail.messages;
    selectedNodeRawMessages.value = normalizedDetail.rawMessages;
    runningPlaceholderViewModel.value = normalizedDetail.runningPlaceholderViewModel || null;
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.snapshotReplaced", {
      sessionId: selectedNodeSessionId.value,
      dialogProcessId: resolveWorkflowDialogProcessId(selectedNode.value || {}),
      turnScopeId: text(selectedNode.value?.turnScopeId),
      workflowRunId: text(selectedNode.value?.workflowRunId),
      messageCount: selectedNodeMessages.value.length,
    });
  }

  function mergeSelectedNodeSessionSnapshot(detail = {}) {
    const currentSessionId = text(selectedNodeSessionId.value || selectedNodeSessionSummary.value?.sessionId);
    const incomingSessionId = text(detail.sessionId || detail.sessionSummary?.sessionId);
    const rootSessionId = text(buildWorkflowDrawerRoute(selectedNode.value || {}).rootSessionId);
    if (shouldRejectRootSessionProjection({ currentSessionId, incomingSessionId, rootSessionId })) {
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.rootProjectionRejected", {
        sessionId: rootSessionId,
        dialogProcessId: resolveWorkflowDialogProcessId(selectedNode.value || {}),
        turnScopeId: text(selectedNode.value?.turnScopeId),
        workflowRunId: text(selectedNode.value?.workflowRunId),
        currentSessionId,
        incomingSessionId,
        messageCount: Array.isArray(detail?.messages) ? detail.messages.length : 0,
      });
      return false;
    }
    const currentDetail = currentSessionId && currentSessionId === incomingSessionId
      ? {
          sessionId: currentSessionId,
          sessionSummary: selectedNodeSessionSummary.value || {},
          messages: selectedNodeMessages.value,
          rawMessages: selectedNodeRawMessages.value,
        }
      : {};
    const mergedDetail = mergeUnifiedSessionDetail(currentDetail, detail);
    const currentComparable = {
      sessionId: currentSessionId,
      sessionSummary: selectedNodeSessionSummary.value || null,
      messages: selectedNodeMessages.value,
      rawMessages: selectedNodeRawMessages.value,
    };
    const nextComparable = {
      sessionId: mergedDetail.sessionId || "",
      sessionSummary: mergedDetail.sessionSummary || null,
      messages: mergedDetail.messages,
      rawMessages: mergedDetail.rawMessages,
    };
    if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) return false;
    selectedNodeSessionSummary.value = mergedDetail.sessionSummary || null;
    selectedNodeSessionId.value = mergedDetail.sessionId || "";
    selectedNodeMessages.value = mergedDetail.messages;
    selectedNodeRawMessages.value = mergedDetail.rawMessages;
    runningPlaceholderViewModel.value = mergedDetail.runningPlaceholderViewModel || null;
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.snapshotMerged", {
      sessionId: selectedNodeSessionId.value,
      dialogProcessId: resolveWorkflowDialogProcessId(selectedNode.value || {}),
      turnScopeId: text(selectedNode.value?.turnScopeId),
      workflowRunId: text(selectedNode.value?.workflowRunId),
      previousSessionId: currentSessionId,
      incomingSessionId,
      messageCount: selectedNodeMessages.value.length,
    });
    return true;
  }

  function applyUnifiedSessionDetailIfAvailable(nodeItem = selectedNode.value || {}) {
    const viewKey = createWorkflowNodeViewKey(nodeItem, workflowPayload.value);
    if (nodeViewTransaction.state.phase !== "live" || nodeViewTransaction.state.ownerKey !== viewKey) return false;
    const detail = buildUnifiedSessionDetail({
      nodeItem,
      runtimeNodeSessions,
      selectSessionMessages: props.selectSessionMessages,
      selectExecutionDetail: props.selectExecutionDetail,
      allowEmptyMessages: false,
    });
    if (!detail) {
      const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.unifiedUnavailable", {
        sessionId: resolveIsolatedNodeSessionId(nodeItem, runtimeNode),
        dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
        turnScopeId: text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId),
        workflowRunId: text(runtimeNode?.workflowRunId || nodeItem?.workflowRunId),
        nodeExecutionId: text(runtimeNode?.nodeExecutionId || nodeItem?.nodeExecutionId),
        stage: "live-apply",
        runtimeNodeCount: Array.isArray(runtimeNodeSessions?.value) ? runtimeNodeSessions.value.length : 0,
      });
      return false;
    }
    logWorkflowNodeDetailProjection({ props, runtimeNodeSessions }, "live-apply", nodeItem, detail);
    if (!nodeViewTransaction.merge(viewKey, detail)) return false;
    selectedExecutionId.value = text(detail.executionId);
    attemptExecutionIds.value = Array.isArray(detail.attemptExecutionIds) ? detail.attemptExecutionIds : [];
    executionDirectory.value = [
      ...(detail.execution ? [detail.execution] : []),
      ...(Array.isArray(detail.descendantExecutions) ? detail.descendantExecutions : []),
    ].filter((item, index, values) => {
      const id = text(item?.executionId);
      return id && values.findIndex((candidate) => text(candidate?.executionId) === id) === index;
    });
    const hasMessages = Array.isArray(detail.messages) && detail.messages.length > 0;
    if (hasMessages || detail.execution) viewerState.value = "streaming";
    return true;
  }

  async function openNodeSession(nodeItem = {}, options = {}) {
    const { fromHistory = false } = options || {};
    const traceId = text(options?.traceId) || createWorkflowNodeDetailTraceId();
    const canonicalNodeItem = resolveCanonicalWorkflowNodeItem(nodeItem, runtimeNodeSessions);
    const viewKey = createWorkflowNodeViewKey(canonicalNodeItem, workflowPayload.value);
    selectedGraphDialogProcessId.value = resolveWorkflowDialogProcessId(canonicalNodeItem);
    const { dialogProcessId, rootSessionId } = buildWorkflowDrawerRoute(canonicalNodeItem);
    const isNewProtocolNode = hasNewProtocolNodeIdentity(canonicalNodeItem);
    const canonicalRuntimeNode = resolveRuntimeNodeSession(canonicalNodeItem, runtimeNodeSessions);
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.openStarted", {
      traceId,
      sessionId: resolveIsolatedNodeSessionId(canonicalNodeItem, canonicalRuntimeNode),
      dialogProcessId,
      turnScopeId: text(canonicalNodeItem?.turnScopeId),
      workflowRunId: text(canonicalNodeItem?.workflowRunId),
      nodeExecutionId: text(canonicalNodeItem?.nodeExecutionId),
      clickedSessionId: text(nodeItem?.sessionId || nodeItem?.nodeSessionId),
      canonicalSessionId: text(canonicalNodeItem?.sessionId || canonicalNodeItem?.nodeSessionId),
      activeChildExecutionId: text(canonicalNodeItem?.activeChildExecutionId || canonicalNodeItem?.childExecutionId),
      runtimeNodeCount: Array.isArray(runtimeNodeSessions?.value) ? runtimeNodeSessions.value.length : 0,
      fromHistory,
      clickedIdentity: summarizeWorkflowNodeIdentity(nodeItem),
      canonicalIdentity: summarizeWorkflowNodeIdentity(canonicalNodeItem),
      runtimeIdentity: summarizeWorkflowNodeIdentity(canonicalRuntimeNode || {}),
      routeIdentity: { rootSessionId, dialogProcessId },
    });
    if (!props.userId || (!isNewProtocolNode && (!rootSessionId || !dialogProcessId))) {
      ElMessage.warning(translate("workflow.nodeSessionMissing"));
      return;
    }
    viewerVisible.value = true;
    if (!fromHistory && rootSessionId && dialogProcessId) {
      pushWorkflowDrawerHistory({ dialogProcessId, rootSessionId });
    }
    viewerError.value = "";
    const owningRuntimeNode = findWorkflowOwningRuntimeNode(canonicalNodeItem, flowNodes?.value);
    if (owningRuntimeNode) selectedRuntimeNode.value = owningRuntimeNode;
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.owningRuntimeNodeResolved", {
      sessionId: resolveIsolatedNodeSessionId(canonicalNodeItem, canonicalRuntimeNode),
      dialogProcessId,
      turnScopeId: text(canonicalNodeItem?.turnScopeId),
      workflowRunId: text(canonicalNodeItem?.workflowRunId),
      nodeExecutionId: text(canonicalNodeItem?.nodeExecutionId),
      owningNodeFound: Boolean(owningRuntimeNode),
      owningNodeId: text(owningRuntimeNode?.nodeId),
      boxCount: Array.isArray(owningRuntimeNode?.actionNodeStates)
        ? owningRuntimeNode.actionNodeStates.length
        : 0,
    });
    selectedRuntimeStep.value = canonicalNodeItem;
    selectedNode.value = canonicalNodeItem;
    const viewTicket = nodeViewTransaction.begin(viewKey);
    viewerState.value = "loading";
    if (isNewProtocolNode) {
      const childExecutionIds = resolveNodeChildExecutionIds(canonicalNodeItem, runtimeNodeSessions);
      const executionId = text(selectedExecutionId.value || childExecutionIds[0]);
      const runtimeNode = resolveRuntimeNodeSession(canonicalNodeItem, runtimeNodeSessions);
      const sessionIdHint = resolveIsolatedNodeSessionId(canonicalNodeItem, runtimeNode);
      selectedExecutionId.value = executionId;
      attemptExecutionIds.value = childExecutionIds;
      try {
        if (sessionIdHint) {
          const detail = await fetchExecutionSessionDetail({
            props,
            translate,
            sessionId: sessionIdHint,
            rootSessionId,
            dialogProcessId,
            traceId,
          });
          props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.restLoaded", {
            sessionId: text(detail?.sessionId || sessionIdHint),
            dialogProcessId,
            turnScopeId: text(canonicalNodeItem?.turnScopeId),
            workflowRunId: text(canonicalNodeItem?.workflowRunId),
            nodeExecutionId: text(canonicalNodeItem?.nodeExecutionId),
            requestedSessionId: sessionIdHint,
            responseState: text(detail?.state),
            messageCount: Array.isArray(detail?.messages) ? detail.messages.length : 0,
            executionLogCount: Array.isArray(detail?.executionLogs) ? detail.executionLogs.length : 0,
          });
          if (isCurrentSessionRequest(viewTicket, sessionIdHint, detail)) {
            if (detail?.state === "pending") {
              viewerState.value = "pending";
            } else {
              const hydratedDetail = hydrateExecutionSessionDetail(detail, {
                executionId,
                execution: executionId && typeof props.selectExecutionDetail === "function"
                  ? props.selectExecutionDetail(executionId)?.execution || null
                  : null,
              });
              const rawMessages = Array.isArray(hydratedDetail.rawMessages)
                ? hydratedDetail.rawMessages
                : hydratedDetail.messages;
              const subSessionMergeResult = typeof applyWorkflowRuntimeEvent === "function"
                ? applyWorkflowRuntimeEvent({
                    event: "workflow_session_snapshot_loaded",
                    data: {
                      ...(hydratedDetail.sessionSummary || {}),
                      sessionId: sessionIdHint,
                      messages: rawMessages,
                      rawMessages,
                      snapshotVersion: Number(hydratedDetail?.sessionVersion || hydratedDetail?.revision || 1),
                    },
                  }, { source: "rest_snapshot" })
                : null;
              props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.subSessionHydrated", {
                sessionId: sessionIdHint,
                dialogProcessId,
                turnScopeId: text(canonicalNodeItem?.turnScopeId),
                workflowRunId: text(canonicalNodeItem?.workflowRunId),
                nodeExecutionId: text(canonicalNodeItem?.nodeExecutionId),
                messageCount: rawMessages.length,
                storeMergeAvailable: typeof applyWorkflowRuntimeEvent === "function",
                storeMergeApplied: subSessionMergeResult?.applied === true,
                storeMergeReason: text(subSessionMergeResult?.reason),
                storedMessageCount: Array.isArray(subSessionMergeResult?.session?.messages)
                  ? subSessionMergeResult.session.messages.length
                  : 0,
              });
              const projectionState = subSessionMergeResult?.session?.status ||
                canonicalRuntimeNode?.status || canonicalRuntimeNode?.state ||
                owningRuntimeNode?.status || owningRuntimeNode?.state ||
                canonicalNodeItem?.status || canonicalNodeItem?.state;
              runningPlaceholderViewModel.value = createRunningAssistantPlaceholderViewModel(rawMessages, {
                  sessionId: sessionIdHint,
                  turnScopeId: text(canonicalNodeItem?.turnScopeId),
                  dialogProcessId,
                  state: projectionState,
                });
              const projectedMessages = projectTurnStatusOntoAssistant(rawMessages, {
                  sessionId: sessionIdHint,
                  turnScopeId: text(canonicalNodeItem?.turnScopeId),
                  dialogProcessId,
                  state: projectionState,
                });
              const messages = projectedMessages;
              nodeViewTransaction.replace(viewTicket, {
                ...hydratedDetail,
                messages,
                rawMessages,
                sessionSummary: {
                  ...(hydratedDetail.sessionSummary || {}),
                  messages,
                },
              });
              viewerState.value = detail?.state === "empty" ? "empty" : "ready";
            }
          }
        } else if (executionId) {
          const result = await loadExecutionSessionDetail(executionId, viewTicket, { sessionIdHint });
          if (nodeViewTransaction.accepts(viewTicket) && result.state !== "stale") {
            viewerState.value = result.state;
          }
          if (result.state === "failed" && nodeViewTransaction.accepts(viewTicket)) {
            viewerError.value = translate("workflow.readNodeSessionFailed");
          }
        } else if (nodeViewTransaction.accepts(viewTicket)) {
          viewerState.value = "pending";
        }
      } catch (error) {
        props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.openFailed", {
          traceId, rootSessionId, dialogProcessId, sessionId: sessionIdHint,
          viewKey, transactionAccepted: nodeViewTransaction.accepts(viewTicket),
          transactionPhase: text(nodeViewTransaction.state.phase),
          transactionOwnerKey: text(nodeViewTransaction.state.ownerKey),
          errorName: String(error?.name || "Error"), errorMessage: String(error?.message || error || ""),
          clickedIdentity: summarizeWorkflowNodeIdentity(nodeItem),
          canonicalIdentity: summarizeWorkflowNodeIdentity(canonicalNodeItem),
        });
        if (nodeViewTransaction.accepts(viewTicket)) {
          viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
          viewerState.value = "failed";
        }
      } finally {
        if (nodeViewTransaction.activate(viewTicket)) {
          applyUnifiedSessionDetailIfAvailable(canonicalNodeItem);
        }
      }
      return;
    }
    if (!rootSessionId || !dialogProcessId) {
      nodeViewTransaction.activate(viewTicket);
      return;
    }
    try {
      const detail = await fetchWorkflowNodeSessionDetail({
        props,
        translate,
        rootSessionId,
        dialogProcessId,
      });
      const targetSessionId = text(canonicalNodeItem?.sessionId || canonicalNodeItem?.nodeSessionId);
      if (!isCurrentSessionRequest(viewTicket, targetSessionId, detail)) return;
      nodeViewTransaction.replace(viewTicket, detail);
      viewerState.value = (detail.messages || []).length ? "ready" : "empty";
    } catch (error) {
      if (!nodeViewTransaction.accepts(viewTicket)) return;
      viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
      viewerState.value = "failed";
    } finally {
      if (nodeViewTransaction.activate(viewTicket)) {
        applyUnifiedSessionDetailIfAvailable(canonicalNodeItem);
      }
    }
  }

  function openWorkflowNodePanel(nodeItem = {}) {
    selectedRuntimeNode.value = nodeItem;
    selectedRuntimeStep.value = null;
    selectedNode.value = nodeItem;
    selectedGraphDialogProcessId.value = "";
    nodeViewTransaction.invalidate();
    viewerError.value = "";
    viewerState.value = "idle";
    viewerVisible.value = true;
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.nodePanelOpened", {
      sessionId: text(nodeItem?.sessionId || nodeItem?.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(nodeItem),
      turnScopeId: text(nodeItem?.turnScopeId),
      workflowRunId: text(nodeItem?.workflowRunId),
      nodeExecutionId: text(nodeItem?.nodeExecutionId),
    });
  }

  async function handleRuntimeStepClick(stepItem = {}) {
    const traceId = createWorkflowNodeDetailTraceId();
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.stepClicked", {
      traceId,
      sessionId: text(stepItem?.sessionId || stepItem?.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(stepItem),
      turnScopeId: text(stepItem?.turnScopeId),
      workflowRunId: text(stepItem?.workflowRunId),
      nodeExecutionId: text(stepItem?.nodeExecutionId),
      stepHasSession: stepHasSession(stepItem),
      renderedIdentity: summarizeWorkflowNodeIdentity(stepItem),
    });
    if (!stepHasSession(stepItem)) return;
    await openNodeSession(stepItem, { traceId });
  }

  function handleSelectedDialogProcessUpdate(dialogProcessId = "") {
    selectedGraphDialogProcessId.value = String(dialogProcessId || "").trim();
  }

  useWorkflowNodeSessionHistory({
    props,
    flowNodes,
    viewerVisible,
    selectedNode,
    selectedRuntimeNode,
    selectedRuntimeStep,
    applyingWorkflowDrawerHistory,
    nodeViewTransaction,
    buildWorkflowDrawerRoute,
    replaceWorkflowDrawerHistory,
    parseWorkflowDrawerRoute,
    findWorkflowSessionTarget,
    openNodeSession,
  });

  watch(
    () => {
      // This read is intentional: selectSessionMessages is an opaque function
      // prop, so Vue cannot discover the Pinia registry it reads internally.
      // The registry replacement is the authoritative reactive invalidation.
      const subSessionMessageRegistry = props.subSessionMessageRegistry;
      const subSessionMessageRegistryVersion = Number(props.subSessionMessageRegistryVersion || 0);
      const viewKey = nodeViewTransaction.state.ownerKey;
      if (nodeViewTransaction.state.phase !== "live" || !viewKey || !selectedRuntimeStep.value) return null;
      const detail = buildUnifiedSessionDetail({
        nodeItem: selectedRuntimeStep.value,
        runtimeNodeSessions,
        selectSessionMessages: props.selectSessionMessages,
        selectExecutionDetail: props.selectExecutionDetail,
        allowEmptyMessages: false,
      });
      if (detail) return { viewKey, detail, subSessionMessageRegistry, subSessionMessageRegistryVersion };
      const runtimeNode = resolveRuntimeNodeSession(selectedRuntimeStep.value, runtimeNodeSessions);
      const sessionId = resolveIsolatedNodeSessionId(selectedRuntimeStep.value, runtimeNode);
      const sessionDoc = sessionId && typeof props.selectSessionMessages === "function"
        ? props.selectSessionMessages(sessionId)
        : null;
      return sessionDoc && typeof sessionDoc === "object"
        ? { viewKey, detail: { sessionId, sessionSummary: sessionDoc, messages: sessionDoc.messages || [], rawMessages: sessionDoc.rawMessages || sessionDoc.messages || [] }, subSessionMessageRegistry, subSessionMessageRegistryVersion }
        : null;
    },
    (projection) => {
      if (!projection) {
        props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.liveProjectionUnavailable", {
          sessionId: text(selectedRuntimeStep.value?.sessionId || selectedRuntimeStep.value?.nodeSessionId),
          dialogProcessId: resolveWorkflowDialogProcessId(selectedRuntimeStep.value || {}),
          turnScopeId: text(selectedRuntimeStep.value?.turnScopeId),
          workflowRunId: text(selectedRuntimeStep.value?.workflowRunId),
          nodeExecutionId: text(selectedRuntimeStep.value?.nodeExecutionId),
          transactionPhase: text(nodeViewTransaction.state.phase),
          transactionOwnerKey: text(nodeViewTransaction.state.ownerKey),
        });
        return;
      }
      const { viewKey, detail } = projection;
      props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.liveProjectionObserved", {
        sessionId: text(detail?.sessionId || detail?.sessionSummary?.sessionId),
        dialogProcessId: resolveWorkflowDialogProcessId(selectedRuntimeStep.value || {}),
        turnScopeId: text(selectedRuntimeStep.value?.turnScopeId),
        workflowRunId: text(selectedRuntimeStep.value?.workflowRunId),
        nodeExecutionId: text(selectedRuntimeStep.value?.nodeExecutionId),
        messageCount: Array.isArray(detail?.messages) ? detail.messages.length : 0,
        subSessionMessageRegistryVersion: Number(projection.subSessionMessageRegistryVersion || 0),
        messages: (Array.isArray(detail?.messages) ? detail.messages : []).map((message = {}) => ({
          id: text(message?.id || message?.messageId),
          role: text(message?.role),
          contentLength: String(message?.content || "").length,
        })),
        viewKey,
      });
      logWorkflowNodeDetailProjection({ props, runtimeNodeSessions }, "live-watch", selectedRuntimeStep.value, detail);
      if (!nodeViewTransaction.merge(viewKey, detail)) return;
      if (detail.executionId) selectedExecutionId.value = text(detail.executionId);
      if (Array.isArray(detail.attemptExecutionIds)) {
        const nextAttempts = detail.attemptExecutionIds.map(text);
        if (JSON.stringify(attemptExecutionIds.value) !== JSON.stringify(nextAttempts)) {
          attemptExecutionIds.value = nextAttempts;
        }
      }
    },
    { deep: true },
  );

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
