/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useWorkflowNodeSessionLabels } from "./workflowNodeSessionLabels";
import { useWorkflowDrawerHistory } from "./workflowDrawerHistory";
import {
  fetchExecutionSessionDetail,
  fetchWorkflowNodeSessionDetail,
  fetchWorkflowNodeThinkingDetail,
  hydrateExecutionSessionDetail,
} from "./workflowNodeSessionDetail";
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";
import { createWorkflowNodeViewTransaction } from "./workflowNodeViewTransaction.js";
import { buildActivityTimelineFromLegacyLogs } from "../../../../../client/noobot-chat/src/public/session-domain.js";
import { buildToolTimelineFromLegacyLogs } from "../../../../../client/noobot-chat/src/public/session-domain.js";
import {
  buildUnifiedSessionDetail,
  hasNewProtocolNodeIdentity,
  mergeUnifiedSessionDetail,
  projectTurnStatusOntoAssistant,
  resolveIsolatedNodeSessionId,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
  withRunningAssistantPlaceholder,
} from "./workflowUnifiedSessionDetail.js";

function text(value) {
  return String(value || "").trim();
}

function normalizePersistedExecutionLogs(logs = [], { turnScopeId = "", dialogProcessId = "" } = {}) {
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  return (Array.isArray(logs) ? logs : [])
    .map((record = {}) => {
      const data = record?.data && typeof record.data === "object" ? record.data : {};
      const event = text(record?.event || data?.eventType || data?.event);
      const displayText = text(
        record?.text ||
        record?.output ||
        data?.text ||
        data?.output ||
        data?.content ||
        (event === "agent_lifecycle_state_changed" ? data?.phase || data?.state : ""),
      );
      return {
        ...record,
        ...data,
        event,
        rawEvent: event,
        type: text(record?.type || data?.type || data?.eventType),
        text: displayText,
        timestamp: text(data?.timestamp || record?.timestamp || record?.ts),
        ts: text(record?.ts || data?.timestamp),
      };
    })
    .filter((record = {}) => {
      const recordScopeId = text(record?.turnScopeId);
      const recordDialogId = text(record?.dialogProcessId);
      if (scopeId && recordScopeId) return recordScopeId === scopeId;
      if (normalizedDialogProcessId && recordDialogId) return recordDialogId === normalizedDialogProcessId;
      return true;
    });
}

function attachPersistedExecutionLogs(messages = [], executionLogs = [], identity = {}) {
  const normalizedLogs = normalizePersistedExecutionLogs(executionLogs, identity);
  if (!normalizedLogs.length) return messages;
  return (Array.isArray(messages) ? messages : []).map((message = {}) => {
    if (message?.workflowNodeRunningPlaceholder !== true) return message;
    return {
      ...message,
      rawEvents: normalizedLogs,
      activityTimeline: buildActivityTimelineFromLegacyLogs(normalizedLogs),
      toolTimeline: buildToolTimelineFromLegacyLogs(normalizedLogs),
    };
  });
}

export function shouldRejectRootSessionProjection({
  currentSessionId = "",
  incomingSessionId = "",
  rootSessionId = "",
} = {}) {
  const current = text(currentSessionId);
  const incoming = text(incomingSessionId);
  const root = text(rootSessionId);
  return Boolean(current && incoming && root && current !== root && incoming === root);
}

export function resolveCanonicalWorkflowNodeItem(nodeItem = {}, runtimeNodeSessions = []) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  return {
    ...(nodeItem && typeof nodeItem === "object" ? nodeItem : {}),
    ...(runtimeNode && typeof runtimeNode === "object" ? runtimeNode : {}),
    rootSessionId: text(runtimeNode?.rootSessionId || nodeItem?.rootSessionId),
  };
}

export function isSameWorkflowDrawerRoute(left = {}, right = {}) {
  const leftDialogProcessId = text(left?.dialogProcessId);
  const leftRootSessionId = text(left?.rootSessionId);
  return Boolean(
    leftDialogProcessId &&
    leftRootSessionId &&
    leftDialogProcessId === text(right?.dialogProcessId) &&
    leftRootSessionId === text(right?.rootSessionId),
  );
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
  viewerState,
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

  function detailSessionId(detail = {}) {
    return text(detail?.sessionId || detail?.sessionSummary?.sessionId || detail?.session?.sessionId || detail?.session?.id);
  }

  function nodeViewKey(nodeItem = {}) {
    const rootSessionId = text(
      nodeItem?.rootSessionId ||
      workflowPayload.value?.planningDialog?.sessionId ||
      workflowPayload.value?.runMeta?.sessionId,
    );
    const identity = [
      text(nodeItem?.nodeExecutionId),
      text(nodeItem?.activeChildExecutionId || nodeItem?.childExecutionId),
      text(nodeItem?.turnScopeId),
      resolveWorkflowDialogProcessId(nodeItem),
      text(nodeItem?.nodeSessionId || nodeItem?.sessionId),
      text(nodeItem?.stepId),
    ].find(Boolean);
    return rootSessionId && identity ? `${rootSessionId}:${identity}` : identity;
  }

  function findOwningRuntimeNode(stepItem = {}) {
    const stepExecutionId = text(stepItem?.nodeExecutionId);
    const stepDialogProcessId = resolveWorkflowDialogProcessId(stepItem);
    const stepSessionId = text(stepItem?.sessionId || stepItem?.nodeSessionId);
    return (Array.isArray(flowNodes?.value) ? flowNodes.value : []).find((nodeItem = {}) =>
      (Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []).some((stateBox = {}) =>
        (Array.isArray(stateBox?.steps) ? stateBox.steps : []).some((candidate = {}) => {
          if (stepExecutionId && text(candidate?.nodeExecutionId) === stepExecutionId) return true;
          if (stepDialogProcessId && resolveWorkflowDialogProcessId(candidate) === stepDialogProcessId) return true;
          return Boolean(stepSessionId && text(candidate?.sessionId || candidate?.nodeSessionId) === stepSessionId);
        }),
      ),
    ) || null;
  }

  function findCurrentRuntimeNode(nodeItem = {}) {
    const nodeId = text(nodeItem?.nodeId);
    const nodeExecutionId = text(nodeItem?.nodeExecutionId);
    const dialogProcessId = resolveWorkflowDialogProcessId(nodeItem);
    const nodes = Array.isArray(flowNodes?.value) ? flowNodes.value : [];
    return nodes.find((candidate = {}) => {
      if (nodeExecutionId && text(candidate?.nodeExecutionId) === nodeExecutionId) return true;
      if (dialogProcessId && resolveWorkflowDialogProcessId(candidate) === dialogProcessId) return true;
      return Boolean(nodeId && text(candidate?.nodeId) === nodeId);
    }) || null;
  }

  watch(
    () => flowNodes?.value,
    () => {
      const previous = selectedRuntimeNode.value;
      if (!previous) return;
      const current = findCurrentRuntimeNode(previous);
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
    },
    { flush: "sync" },
  );

  function isCurrentSessionRequest(viewTicket, targetSessionId = "", detail = null) {
    if (!nodeViewTransaction.accepts(viewTicket)) return false;
    const expectedSessionId = text(targetSessionId);
    const responseSessionId = detailSessionId(detail || {});
    if (expectedSessionId && responseSessionId && expectedSessionId !== responseSessionId) return false;
    return true;
  }

  function logNodeDetailProjection(stage = "", nodeItem = {}, detail = {}) {
    const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
    const executionSessionId = text(detail?.execution?.sessionId || detail?.session?.sessionId || detail?.session?.id);
    const messages = Array.isArray(detail?.messages) ? detail.messages : [];
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.projected", {
      sessionId: text(detail?.sessionId || detail?.sessionSummary?.sessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
      turnScopeId: text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId),
      workflowRunId: text(runtimeNode?.workflowRunId || nodeItem?.workflowRunId),
      nodeExecutionId: text(runtimeNode?.nodeExecutionId || nodeItem?.nodeExecutionId),
      stage,
      isolatedNodeSessionId: resolveIsolatedNodeSessionId(nodeItem, runtimeNode),
      executionSessionId,
      messageCount: messages.length,
      messages: messages.map((message = {}) => ({
        id: text(message?.id || message?.messageId),
        role: text(message?.role),
        sessionId: text(message?.sessionId),
        turnScopeId: text(message?.turnScopeId),
        dialogProcessId: text(message?.dialogProcessId),
        pending: message?.pending === true,
        workflowNodeRunningPlaceholder: message?.workflowNodeRunningPlaceholder === true,
        contentLength: String(message?.content || "").length,
      })),
    });
    const projectedAssistants = messages.filter((message = {}) =>
      text(message?.role).toLowerCase() === "assistant" &&
      Boolean(text(message?.statusTurnScopeId) || text(message?.projectedStatusStepState)));
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.statusProjected", {
      sessionId: text(detail?.sessionId || detail?.sessionSummary?.sessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
      turnScopeId: text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId),
      workflowRunId: text(runtimeNode?.workflowRunId || nodeItem?.workflowRunId),
      nodeExecutionId: text(runtimeNode?.nodeExecutionId || nodeItem?.nodeExecutionId),
      stage,
      assistantFound: messages.some((message = {}) => text(message?.role).toLowerCase() === "assistant"),
      projectedAssistantCount: projectedAssistants.length,
      projectedAssistants: projectedAssistants.map((message = {}) => ({
        id: text(message?.id || message?.messageId),
        statusTurnScopeId: text(message?.statusTurnScopeId),
        projectedStatusStepState: text(message?.projectedStatusStepState),
      })),
    });
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
    const viewKey = nodeViewKey(nodeItem);
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
    logNodeDetailProjection("live-apply", nodeItem, detail);
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
    const canonicalNodeItem = resolveCanonicalWorkflowNodeItem(nodeItem, runtimeNodeSessions);
    const viewKey = nodeViewKey(canonicalNodeItem);
    selectedGraphDialogProcessId.value = resolveWorkflowDialogProcessId(canonicalNodeItem);
    const { dialogProcessId, rootSessionId } = buildWorkflowDrawerRoute(canonicalNodeItem);
    const isNewProtocolNode = hasNewProtocolNodeIdentity(canonicalNodeItem);
    const canonicalRuntimeNode = resolveRuntimeNodeSession(canonicalNodeItem, runtimeNodeSessions);
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.openStarted", {
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
    const owningRuntimeNode = findOwningRuntimeNode(canonicalNodeItem);
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
              const subSessionMergeResult = typeof mergeSubSessionSnapshot === "function"
                ? mergeSubSessionSnapshot({
                    ...(hydratedDetail.sessionSummary || {}),
                    sessionId: sessionIdHint,
                    messages: rawMessages,
                    rawMessages,
                  })
                : null;
              props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.subSessionHydrated", {
                sessionId: sessionIdHint,
                dialogProcessId,
                turnScopeId: text(canonicalNodeItem?.turnScopeId),
                workflowRunId: text(canonicalNodeItem?.workflowRunId),
                nodeExecutionId: text(canonicalNodeItem?.nodeExecutionId),
                messageCount: rawMessages.length,
                storeMergeAvailable: typeof mergeSubSessionSnapshot === "function",
                storeMergeApplied: subSessionMergeResult?.applied === true,
                storeMergeReason: text(subSessionMergeResult?.reason),
                storedMessageCount: Array.isArray(subSessionMergeResult?.session?.messages)
                  ? subSessionMergeResult.session.messages.length
                  : 0,
              });
              const projectionState = subSessionMergeResult?.session?.status ||
                canonicalNodeItem?.status || canonicalNodeItem?.state || canonicalNodeItem?.stepStatus;
              const placeholderMessages = projectTurnStatusOntoAssistant(
                withRunningAssistantPlaceholder(rawMessages, {
                  sessionId: sessionIdHint,
                  turnScopeId: text(canonicalNodeItem?.turnScopeId),
                  dialogProcessId,
                  state: projectionState,
                }),
                {
                  sessionId: sessionIdHint,
                  turnScopeId: text(canonicalNodeItem?.turnScopeId),
                  dialogProcessId,
                  state: projectionState,
                },
              );
              const messages = attachPersistedExecutionLogs(
                placeholderMessages,
                hydratedDetail.executionLogs,
                {
                  turnScopeId: text(canonicalNodeItem?.turnScopeId),
                  dialogProcessId: resolveWorkflowDialogProcessId(rawMessages.find((message = {}) =>
                    text(message?.role).toLowerCase() === "user") || canonicalNodeItem),
                },
              );
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
    props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.stepClicked", {
      sessionId: text(stepItem?.sessionId || stepItem?.nodeSessionId),
      dialogProcessId: resolveWorkflowDialogProcessId(stepItem),
      turnScopeId: text(stepItem?.turnScopeId),
      workflowRunId: text(stepItem?.workflowRunId),
      nodeExecutionId: text(stepItem?.nodeExecutionId),
      stepHasSession: stepHasSession(stepItem),
    });
    if (!stepHasSession(stepItem)) return;
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
        selectedRuntimeNode.value = flowNodes.value.find((nodeItem = {}) =>
          (Array.isArray(nodeItem?.actionNodeStates) ? nodeItem.actionNodeStates : []).some((stateBox = {}) =>
            (Array.isArray(stateBox?.steps) ? stateBox.steps : []).includes(target),
          ),
        ) || selectedRuntimeNode.value;
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
      const selectedRoute = selectedNode.value
        ? buildWorkflowDrawerRoute(selectedNode.value)
        : null;
      if (selectedRoute && isSameWorkflowDrawerRoute(initialRoute, selectedRoute)) {
        props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.initialRouteConsumed", {
          sessionId: text(initialRoute.rootSessionId),
          dialogProcessId: text(initialRoute.dialogProcessId),
          turnScopeId: text(selectedNode.value?.turnScopeId),
          workflowRunId: text(selectedNode.value?.workflowRunId),
          nodeExecutionId: text(selectedNode.value?.nodeExecutionId),
          reason: "existing_viewer_selection",
        });
        replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
        return;
      }
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
      nodeViewTransaction.invalidate();
      replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
    },
    { flush: "sync" },
  );

  watch(
    () => {
      const viewKey = nodeViewTransaction.state.ownerKey;
      if (nodeViewTransaction.state.phase !== "live" || !viewKey || !selectedRuntimeStep.value) return null;
      const detail = buildUnifiedSessionDetail({
        nodeItem: selectedRuntimeStep.value,
        runtimeNodeSessions,
        selectSessionMessages: props.selectSessionMessages,
        selectExecutionDetail: props.selectExecutionDetail,
        allowEmptyMessages: false,
      });
      if (detail) return { viewKey, detail };
      const runtimeNode = resolveRuntimeNodeSession(selectedRuntimeStep.value, runtimeNodeSessions);
      const sessionId = resolveIsolatedNodeSessionId(selectedRuntimeStep.value, runtimeNode);
      const sessionDoc = sessionId && typeof props.selectSessionMessages === "function"
        ? props.selectSessionMessages(sessionId)
        : null;
      return sessionDoc && typeof sessionDoc === "object"
        ? { viewKey, detail: { sessionId, sessionSummary: sessionDoc, messages: sessionDoc.messages || [], rawMessages: sessionDoc.rawMessages || sessionDoc.messages || [] } }
        : null;
    },
    (projection) => {
      if (!projection) return;
      const { viewKey, detail } = projection;
      logNodeDetailProjection("live-watch", selectedRuntimeStep.value, detail);
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
