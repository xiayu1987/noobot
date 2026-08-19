/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { watch } from "vue";
import { logWorkflowNodeDetailProjection } from "../../runtime/workflowNodeSessionDiagnostics.js";
import {
  buildUnifiedSessionDetail,
  isTerminalExecutionProjection,
  resolveIsolatedNodeSessionId,
  resolveRuntimeNodeSession,
} from "../../runtime/workflowUnifiedSessionDetail.js";
import { createWorkflowNodeViewKey } from "../../runtime/workflowNodeSessionRuntime.js";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";

const text = (value) => String(value || "").trim();

function uniqueExecutions(detail = {}) {
  return [
    ...(detail.execution ? [detail.execution] : []),
    ...(Array.isArray(detail.descendantExecutions) ? detail.descendantExecutions : []),
  ].filter((item, index, values) => {
    const id = text(item?.executionId);
    return id && values.findIndex((candidate) => text(candidate?.executionId) === id) === index;
  });
}

function logUnavailable({ props, runtimeNodeSessions, nodeItem, stage, extra = {} }) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  props.logWorkflowDiagnostics?.(`frontend.workflowNodeDetail.${stage}`, {
    sessionId: resolveIsolatedNodeSessionId(nodeItem, runtimeNode),
    dialogProcessId:
      resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
    turnScopeId: text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId),
    workflowRunId: text(runtimeNode?.workflowRunId || nodeItem?.workflowRunId),
    nodeExecutionId: text(runtimeNode?.nodeExecutionId || nodeItem?.nodeExecutionId),
    runtimeNodeCount: Array.isArray(runtimeNodeSessions?.value)
      ? runtimeNodeSessions.value.length
      : 0,
    ...extra,
  });
}

function buildLiveProjection({ props, runtimeNodeSessions, nodeViewTransaction, refs }) {
  const registry = props.subSessionMessageRegistry;
  const registryVersion = Number(props.subSessionMessageRegistryVersion || 0);
  const viewKey = nodeViewTransaction.state.ownerKey;
  const transactionPhase = text(nodeViewTransaction.state.phase);
  const selectedStep = refs.selectedRuntimeStep.value;
  const unavailable = (reason, extra = {}) => ({
    available: false,
    reason,
    viewKey,
    transactionPhase,
    selectedStep,
    subSessionMessageRegistry: registry,
    subSessionMessageRegistryVersion: registryVersion,
    ...extra,
  });
  if (transactionPhase !== "live") return unavailable("transaction_not_live");
  if (!viewKey) return unavailable("missing_transaction_owner");
  if (!selectedStep) return unavailable("missing_selected_runtime_step");
  const detail = buildUnifiedSessionDetail({
    nodeItem: selectedStep,
    runtimeNodeSessions,
    selectSessionMessages: props.selectSessionMessages,
    selectExecutionDetail: props.selectExecutionDetail,
    allowEmptyMessages: false,
  });
  if (detail)
    return {
      available: true,
      viewKey,
      detail,
      subSessionMessageRegistry: registry,
      subSessionMessageRegistryVersion: registryVersion,
    };
  const runtimeNode = resolveRuntimeNodeSession(selectedStep, runtimeNodeSessions);
  const sessionId = resolveIsolatedNodeSessionId(selectedStep, runtimeNode);
  if (!sessionId)
    return unavailable("missing_session_identity", { runtimeNodeFound: Boolean(runtimeNode) });
  if (typeof props.selectSessionMessages !== "function") {
    return unavailable("missing_session_selector", {
      sessionId,
      runtimeNodeFound: Boolean(runtimeNode),
    });
  }
  const sessionDoc = props.selectSessionMessages(sessionId);
  if (!sessionDoc || typeof sessionDoc !== "object") {
    return unavailable("session_projection_unavailable", {
      sessionId,
      runtimeNodeFound: Boolean(runtimeNode),
    });
  }
  return {
    available: true,
    viewKey,
    detail: {
      sessionId,
      sessionSummary: sessionDoc,
      messages: sessionDoc.messages || [],
      rawMessages: sessionDoc.rawMessages || [],
    },
    subSessionMessageRegistry: registry,
    subSessionMessageRegistryVersion: registryVersion,
  };
}

function logObserved({ props, refs, projection }) {
  const detail = projection.detail;
  const selectedStep = refs.selectedRuntimeStep.value || {};
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.liveProjectionObserved", {
    sessionId: text(detail.sessionId || detail.sessionSummary?.sessionId),
    dialogProcessId: resolveWorkflowDialogProcessId(selectedStep),
    turnScopeId: text(selectedStep.turnScopeId),
    workflowRunId: text(selectedStep.workflowRunId),
    nodeExecutionId: text(selectedStep.nodeExecutionId),
    messageCount: Array.isArray(detail.messages) ? detail.messages.length : 0,
    subSessionMessageRegistryVersion: Number(projection.subSessionMessageRegistryVersion || 0),
    messages: (Array.isArray(detail.messages) ? detail.messages : []).map((message = {}) => ({
      id: text(message.id || message.messageId),
      role: text(message.role),
      contentLength: String(message.content || "").length,
    })),
    viewKey: projection.viewKey,
  });
}

function applyObservedProjection(context, projection) {
  const { props, refs, runtimeNodeSessions, nodeViewTransaction } = context;
  if (!projection?.available) {
    const selectedStep = projection?.selectedStep || refs.selectedRuntimeStep.value || {};
    logUnavailable({
      props,
      runtimeNodeSessions,
      nodeItem: selectedStep,
      stage: "liveProjectionUnavailable",
      extra: {
        reason: text(projection?.reason) || "projection_state_unavailable",
        transactionPhase: text(projection?.transactionPhase || nodeViewTransaction.state.phase),
        transactionOwnerKey: text(projection?.viewKey || nodeViewTransaction.state.ownerKey),
        selectedRuntimeStepPresent: Boolean(selectedStep && Object.keys(selectedStep).length),
        runtimeNodeFound: projection?.runtimeNodeFound === true,
        sessionSelectorAvailable: typeof props.selectSessionMessages === "function",
        subSessionMessageRegistryVersion: Number(projection?.subSessionMessageRegistryVersion || 0),
      },
    });
    return;
  }
  logObserved({ props, refs, projection });
  logWorkflowNodeDetailProjection(
    { props, runtimeNodeSessions },
    "live-watch",
    refs.selectedRuntimeStep.value,
    projection.detail,
  );
  if (!nodeViewTransaction.merge(projection.viewKey, projection.detail)) return;
  if (projection.detail.executionId)
    refs.selectedExecutionId.value = text(projection.detail.executionId);
  if (!Array.isArray(projection.detail.attemptExecutionIds)) return;
  const nextAttempts = projection.detail.attemptExecutionIds.map(text);
  if (JSON.stringify(refs.attemptExecutionIds.value) !== JSON.stringify(nextAttempts)) {
    refs.attemptExecutionIds.value = nextAttempts;
  }
}

export function createLiveProjectionController(context) {
  const { props, workflowPayload, runtimeNodeSessions, nodeViewTransaction, refs } = context;
  function applyAvailable(nodeItem = refs.selectedNode.value || {}) {
    const viewKey = createWorkflowNodeViewKey(nodeItem, workflowPayload.value);
    if (
      nodeViewTransaction.state.phase !== "live" ||
      nodeViewTransaction.state.ownerKey !== viewKey
    )
      return false;
    const detail = buildUnifiedSessionDetail({
      nodeItem,
      runtimeNodeSessions,
      selectSessionMessages: props.selectSessionMessages,
      selectExecutionDetail: props.selectExecutionDetail,
      allowEmptyMessages: false,
    });
    if (!detail) {
      logUnavailable({
        props,
        runtimeNodeSessions,
        nodeItem,
        stage: "unifiedUnavailable",
        extra: { stage: "live-apply" },
      });
      return false;
    }
    logWorkflowNodeDetailProjection({ props, runtimeNodeSessions }, "live-apply", nodeItem, detail);
    if (!nodeViewTransaction.merge(viewKey, detail)) return false;
    refs.selectedExecutionId.value = text(detail.executionId);
    refs.attemptExecutionIds.value = Array.isArray(detail.attemptExecutionIds)
      ? detail.attemptExecutionIds
      : [];
    refs.executionDirectory.value = uniqueExecutions(detail);
    if (detail.execution) {
      const hasMessages = Array.isArray(detail.messages) && detail.messages.length > 0;
      refs.viewerState.value = isTerminalExecutionProjection(detail.execution)
        ? hasMessages
          ? "ready"
          : "empty"
        : "streaming";
    }
    return true;
  }

  function watchProjection() {
    return watch(
      () => buildLiveProjection(context),
      (projection) => applyObservedProjection(context, projection),
      { deep: true },
    );
  }

  return { applyAvailable, watchProjection };
}
