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
import { text } from "@noobot/shared/value";

function describeRuntimeNode(runtimeNode) {
  return {
    nodeSessionId: resolveIsolatedNodeSessionId(runtimeNode),
    dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode),
    turnScopeId: text(runtimeNode.turnScopeId),
    workflowRunId: text(runtimeNode.workflowRunId),
    nodeExecutionId: text(runtimeNode.nodeExecutionId),
  };
}

function logUnavailable({ props, runtimeNodeSessions, stage, fields }) {
  props.logWorkflowDiagnostics(`frontend.workflowNodeDetail.${stage}`, {
    runtimeNodeCount: runtimeNodeSessions.value.length,
    ...fields,
  });
}

function buildLiveProjection({ props, runtimeNodeSessions, nodeViewTransaction, refs }) {
  const registry = props.subSessionMessageRegistry;
  const registryVersion = props.subSessionMessageRegistryVersion;
  const viewKey = nodeViewTransaction.state.ownerKey;
  const transactionPhase = text(nodeViewTransaction.state.phase);
  const selectedStep = refs.selectedRuntimeStep.value;
  const unavailable = (reason, nodeFields = {}) => ({
    available: false,
    reason,
    viewKey,
    transactionPhase,
    selectedRuntimeStepPresent: Boolean(selectedStep),
    nodeFields,
    subSessionMessageRegistry: registry,
    subSessionMessageRegistryVersion: registryVersion,
  });
  if (!["loading", "live"].includes(transactionPhase)) return unavailable("transaction_not_active");
  if (!viewKey) return unavailable("missing_transaction_owner");
  if (!selectedStep) return unavailable("missing_selected_runtime_step");
  const detail = buildUnifiedSessionDetail({
    nodeItem: selectedStep,
    runtimeNodeSessions,
    selectSessionMessages: props.selectSessionMessages,
    selectExecutionDetail: props.selectExecutionDetail,
  });
  if (!detail) {
    return unavailable(
      "unified_projection_unavailable",
      describeRuntimeNode(resolveRuntimeNodeSession(selectedStep, runtimeNodeSessions)),
    );
  }
  return {
    available: true,
    viewKey,
    detail,
    selectedStep,
    subSessionMessageRegistry: registry,
    subSessionMessageRegistryVersion: registryVersion,
  };
}

function logObserved({ props, projection }) {
  const { detail, selectedStep } = projection;
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.liveProjectionObserved", {
    sessionId: text(detail.sessionId),
    dialogProcessId: resolveWorkflowDialogProcessId(selectedStep),
    turnScopeId: text(selectedStep.turnScopeId),
    workflowRunId: text(selectedStep.workflowRunId),
    nodeExecutionId: text(selectedStep.nodeExecutionId),
    messageCount: detail.messages.length,
    subSessionMessageRegistryVersion: projection.subSessionMessageRegistryVersion,
    messages: detail.messages.map((message) => ({
      messageUid: text(message.messageUid),
      presentationMessageId: text(message.presentationMessageId),
      role: text(message.role),
      contentLength: String(message.content || "").length,
    })),
    viewKey: projection.viewKey,
  });
}

function applyObservedProjection(context, projection) {
  const { props, refs, runtimeNodeSessions, nodeViewTransaction } = context;
  if (!projection.available) {
    logUnavailable({
      props,
      runtimeNodeSessions,
      stage: "liveProjectionUnavailable",
      fields: {
        reason: projection.reason,
        transactionPhase: projection.transactionPhase,
        transactionOwnerKey: text(projection.viewKey),
        selectedRuntimeStepPresent: projection.selectedRuntimeStepPresent,
        subSessionMessageRegistryVersion: projection.subSessionMessageRegistryVersion,
        ...projection.nodeFields,
      },
    });
    return;
  }
  logObserved({ props, projection });
  logWorkflowNodeDetailProjection(
    { props, runtimeNodeSessions },
    "live-watch",
    refs.selectedRuntimeStep.value,
    projection.detail,
  );
  if (!nodeViewTransaction.merge(projection.viewKey, projection.detail)) return;
  if (projection.detail.executionId) refs.selectedExecutionId.value = projection.detail.executionId;
  const nextAttempts = projection.detail.attemptExecutionIds;
  if (JSON.stringify(refs.attemptExecutionIds.value) !== JSON.stringify(nextAttempts)) {
    refs.attemptExecutionIds.value = nextAttempts;
  }
}

export function createLiveProjectionController(context) {
  const { props, runtimeNodeSessions, nodeViewTransaction, refs } = context;
  function applyAvailable(nodeItem) {
    const viewKey = createWorkflowNodeViewKey(nodeItem);
    if (
      !["loading", "live"].includes(nodeViewTransaction.state.phase) ||
      nodeViewTransaction.state.ownerKey !== viewKey
    )
      return false;
    const detail = buildUnifiedSessionDetail({
      nodeItem,
      runtimeNodeSessions,
      selectSessionMessages: props.selectSessionMessages,
      selectExecutionDetail: props.selectExecutionDetail,
    });
    if (!detail) {
      logUnavailable({
        props,
        runtimeNodeSessions,
        stage: "unifiedUnavailable",
        fields: {
          stage: "live-apply",
          ...describeRuntimeNode(resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions)),
        },
      });
      return false;
    }
    logWorkflowNodeDetailProjection({ props, runtimeNodeSessions }, "live-apply", nodeItem, detail);
    if (!nodeViewTransaction.merge(viewKey, detail)) return false;
    refs.selectedExecutionId.value = detail.executionId;
    refs.attemptExecutionIds.value = detail.attemptExecutionIds;
    refs.executionDirectory.value = detail.execution
      ? [detail.execution, ...detail.descendantExecutions]
      : [];
    if (detail.execution) {
      const hasMessages = detail.messages.length > 0;
      refs.viewerState.value = isTerminalExecutionProjection(detail.execution)
        ? hasMessages
          ? "ready"
          : "empty"
        : "streaming";
    } else {
      refs.viewerState.value = detail.messages.length ? "ready" : "empty";
    }
    return true;
  }

  function watchProjection() {
    function rejectProjection(candidate, error) {
      if (!nodeViewTransaction.fail(candidate)) return;
      refs.viewerError.value = error.message;
      refs.viewerState.value = "failed";
    }
    return watch(
      () => {
        const candidate = nodeViewTransaction.ticket();
        try {
          return { candidate, projection: buildLiveProjection(context) };
        } catch (error) {
          return { candidate, error };
        }
      },
      ({ candidate, projection, error }) => {
        if (error) return rejectProjection(candidate, error);
        try {
          applyObservedProjection(context, projection);
        } catch (error) {
          rejectProjection(candidate, error);
        }
      },
      { deep: true },
    );
  }

  return { applyAvailable, watchProjection };
}
