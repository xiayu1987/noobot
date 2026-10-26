/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage } from "element-plus";
import { summarizeWorkflowNodeIdentity } from "../../runtime/workflowNodeSessionDiagnostics.js";
import {
  createWorkflowNodeViewKey,
  findWorkflowOwningRuntimeNode,
} from "../../runtime/workflowNodeSessionRuntime.js";
import { resolveCanonicalWorkflowNodeItem } from "../../runtime/workflowNodeSessionIdentity.js";
import {
  fetchExecutionSessionDetail,
  hydrateExecutionSessionDetail,
} from "../../runtime/workflowNodeSessionDetail.js";
import {
  createRunningAssistantPlaceholderViewModel,
  isWorkflowNodeRunning,
  resolveIsolatedNodeSessionId,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
} from "../../runtime/workflowUnifiedSessionDetail.js";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";
import { text } from "@noobot/shared/value";

function isCurrentRequest(nodeViewTransaction, viewTicket, targetSessionId, detail) {
  if (!nodeViewTransaction.accepts(viewTicket)) return false;
  const expectedSessionId = text(targetSessionId);
  return !expectedSessionId || expectedSessionId === detail.sessionId;
}

function logOpenStarted(context, prepared) {
  const { props, runtimeNodeSessions } = context;
  const { traceId, nodeItem, canonicalNodeItem, canonicalRuntimeNode, route, fromHistory } =
    prepared;
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.openStarted", {
    traceId,
    nodeSessionId: resolveIsolatedNodeSessionId(canonicalRuntimeNode),
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    clickedNodeSessionId: text(nodeItem.nodeSessionId),
    canonicalNodeSessionId: text(canonicalNodeItem.nodeSessionId),
    activeChildExecutionId: text(canonicalNodeItem.activeChildExecutionId),
    runtimeNodeCount: runtimeNodeSessions.value.length,
    fromHistory,
    clickedIdentity: summarizeWorkflowNodeIdentity(nodeItem),
    canonicalIdentity: summarizeWorkflowNodeIdentity(canonicalNodeItem),
    runtimeIdentity: summarizeWorkflowNodeIdentity(canonicalRuntimeNode || {}),
    routeIdentity: route,
  });
}

function prepareOpen(context, nodeItem, options) {
  const { runtimeNodeSessions, buildWorkflowDrawerRoute } = context;
  const fromHistory = options.fromHistory === true;
  const { traceId } = options;
  const canonicalNodeItem = resolveCanonicalWorkflowNodeItem(nodeItem, runtimeNodeSessions);
  const route = buildWorkflowDrawerRoute(canonicalNodeItem);
  return {
    nodeItem,
    fromHistory,
    traceId,
    canonicalNodeItem,
    canonicalRuntimeNode: resolveRuntimeNodeSession(canonicalNodeItem, runtimeNodeSessions),
    route,
    viewKey: createWorkflowNodeViewKey(canonicalNodeItem),
  };
}

function beginOpen(context, prepared) {
  const { props, translate, flowNodes, refs, nodeViewTransaction } = context;
  const { canonicalNodeItem, canonicalRuntimeNode, route, viewKey } = prepared;
  refs.selectedGraphDialogProcessId.value = resolveWorkflowDialogProcessId(canonicalNodeItem);
  logOpenStarted(context, prepared);
  if (!props.userId || !route.rootSessionId || !route.dialogProcessId) {
    ElMessage.warning(translate("workflow.nodeSessionMissing"));
    return null;
  }
  refs.viewerVisible.value = true;
  refs.viewerError.value = "";
  const owningRuntimeNode = findWorkflowOwningRuntimeNode(canonicalNodeItem, flowNodes?.value);
  if (owningRuntimeNode) refs.selectedRuntimeNode.value = owningRuntimeNode;
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.owningRuntimeNodeResolved", {
    nodeSessionId: resolveIsolatedNodeSessionId(canonicalRuntimeNode),
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    owningNodeFound: Boolean(owningRuntimeNode),
    owningNodeId: text(owningRuntimeNode?.nodeId),
    boxCount: Array.isArray(owningRuntimeNode?.actionNodeStates)
      ? owningRuntimeNode.actionNodeStates.length
      : 0,
  });
  refs.selectedRuntimeStep.value = canonicalNodeItem;
  refs.selectedNode.value = canonicalNodeItem;
  refs.viewerState.value = "loading";
  return { owningRuntimeNode, viewTicket: nodeViewTransaction.begin(viewKey) };
}

function applyRestSnapshot({ context, prepared, opening, hydratedDetail, mergeResult }) {
  const { canonicalNodeItem, canonicalRuntimeNode, route } = prepared;
  context.refs.runningPlaceholderViewModel.value = createRunningAssistantPlaceholderViewModel(
    hydratedDetail.messages,
    {
      sessionId: hydratedDetail.sessionId,
      turnScopeId: text(canonicalNodeItem.turnScopeId),
      dialogProcessId: route.dialogProcessId,
      running: isWorkflowNodeRunning(canonicalRuntimeNode),
    },
  );
  if (!mergeResult.applied) return;
  context.nodeViewTransaction.replace(opening.viewTicket, {
    ...hydratedDetail,
    messages: mergeResult.session.messages,
  });
}

function mergeRestSnapshot(context, prepared, opening, hydratedDetail) {
  const { props, applyWorkflowRuntimeEvent } = context;
  const { canonicalNodeItem, route } = prepared;
  const mergeResult = applyWorkflowRuntimeEvent(hydratedDetail.snapshotEnvelope, {
    source: "rest_snapshot",
  });
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.subSessionHydrated", {
    sessionId: hydratedDetail.sessionId,
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    messageCount: hydratedDetail.messages.length,
    storeMergeApplied: mergeResult.applied,
    storeMergeReason: text(mergeResult.reason),
    storedMessageCount: mergeResult.applied ? mergeResult.session.messages.length : null,
  });
  applyRestSnapshot({ context, prepared, opening, hydratedDetail, mergeResult });
}

async function loadMaterializedSession(context, prepared, opening, identity) {
  const { props, translate, nodeViewTransaction, refs } = context;
  const { route, canonicalNodeItem, traceId } = prepared;
  const { sessionIdHint, executionId } = identity;
  const detail = await fetchExecutionSessionDetail({
    props,
    translate,
    sessionId: sessionIdHint,
    rootSessionId: route.rootSessionId,
    dialogProcessId: route.dialogProcessId,
    traceId,
  });
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.restLoaded", {
    sessionId: detail.sessionId,
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    requestedSessionId: sessionIdHint,
    responseState: detail.state,
    messageCount: detail.messages.length,
    executionLogCount: detail.executionLogs.length,
  });
  if (!isCurrentRequest(nodeViewTransaction, opening.viewTicket, sessionIdHint, detail)) return;
  const hydratedDetail = hydrateExecutionSessionDetail(detail, { executionId });
  mergeRestSnapshot(context, prepared, opening, hydratedDetail);
  refs.viewerState.value = detail.state;
}

function recordOpenFailure(context, prepared, opening, identity, error) {
  const { props, refs, nodeViewTransaction, translate } = context;
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.openFailed", {
    traceId: prepared.traceId,
    rootSessionId: prepared.route.rootSessionId,
    dialogProcessId: prepared.route.dialogProcessId,
    sessionId: identity.sessionIdHint,
    viewKey: prepared.viewKey,
    transactionAccepted: nodeViewTransaction.accepts(opening.viewTicket),
    transactionPhase: text(nodeViewTransaction.state.phase),
    transactionOwnerKey: text(nodeViewTransaction.state.ownerKey),
    errorName: String(error?.name || "Error"),
    errorMessage: String(error?.message || error || ""),
    clickedIdentity: summarizeWorkflowNodeIdentity(prepared.nodeItem),
    canonicalIdentity: summarizeWorkflowNodeIdentity(prepared.canonicalNodeItem),
  });
  if (!nodeViewTransaction.accepts(opening.viewTicket)) return;
  refs.viewerError.value = String(
    error?.message || error || translate("workflow.readNodeSessionFailed"),
  );
  refs.viewerState.value = "failed";
}

async function openNewProtocolSession(context, prepared, opening) {
  const { refs, runtimeNodeSessions, nodeViewTransaction, applyUnifiedSessionDetailIfAvailable } =
    context;
  const childExecutionIds = resolveNodeChildExecutionIds(
    prepared.canonicalNodeItem,
    runtimeNodeSessions,
  );
  const identity = {
    executionId: text(refs.selectedExecutionId.value || childExecutionIds[0]),
    sessionIdHint: resolveIsolatedNodeSessionId(prepared.canonicalRuntimeNode),
  };
  refs.selectedExecutionId.value = identity.executionId;
  refs.attemptExecutionIds.value = childExecutionIds;
  applyUnifiedSessionDetailIfAvailable(prepared.canonicalNodeItem);
  try {
    if (identity.sessionIdHint) await loadMaterializedSession(context, prepared, opening, identity);
    else if (nodeViewTransaction.accepts(opening.viewTicket)) refs.viewerState.value = "pending";
  } catch (error) {
    recordOpenFailure(context, prepared, opening, identity, error);
  } finally {
    if (nodeViewTransaction.activate(opening.viewTicket)) {
      applyUnifiedSessionDetailIfAvailable(prepared.canonicalNodeItem);
    }
  }
}

export function createNodeSessionOpeningController(context) {
  return async function openNodeSession(nodeItem, options) {
    const prepared = prepareOpen(context, nodeItem, options);
    const opening = beginOpen(context, prepared);
    if (!opening) return;
    await openNewProtocolSession(context, prepared, opening);
  };
}
