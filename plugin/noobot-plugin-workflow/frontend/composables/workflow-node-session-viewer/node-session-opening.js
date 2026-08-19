/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ElMessage } from "element-plus";
import {
  createWorkflowNodeDetailTraceId,
  summarizeWorkflowNodeIdentity,
} from "../../runtime/workflowNodeSessionDiagnostics.js";
import {
  createWorkflowNodeViewKey,
  findWorkflowOwningRuntimeNode,
  resolveWorkflowDetailSessionId,
} from "../../runtime/workflowNodeSessionRuntime.js";
import { resolveCanonicalWorkflowNodeItem } from "../../runtime/workflowNodeSessionIdentity.js";
import {
  fetchExecutionSessionDetail,
  hydrateExecutionSessionDetail,
} from "../../runtime/workflowNodeSessionDetail.js";
import {
  createRunningAssistantPlaceholderViewModel,
  resolveIsolatedNodeSessionId,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
} from "../../runtime/workflowUnifiedSessionDetail.js";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";

const text = (value) => String(value || "").trim();

function isCurrentRequest(nodeViewTransaction, viewTicket, targetSessionId, detail) {
  if (!nodeViewTransaction.accepts(viewTicket)) return false;
  const expectedSessionId = text(targetSessionId);
  const responseSessionId = resolveWorkflowDetailSessionId(detail || {});
  return !(expectedSessionId && responseSessionId && expectedSessionId !== responseSessionId);
}

function logOpenStarted(context, prepared) {
  const { props, runtimeNodeSessions } = context;
  const { traceId, nodeItem, canonicalNodeItem, canonicalRuntimeNode, route, fromHistory } =
    prepared;
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.openStarted", {
    traceId,
    sessionId: resolveIsolatedNodeSessionId(canonicalNodeItem, canonicalRuntimeNode),
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    clickedSessionId: text(nodeItem.sessionId || nodeItem.nodeSessionId),
    canonicalSessionId: text(canonicalNodeItem.sessionId || canonicalNodeItem.nodeSessionId),
    activeChildExecutionId: text(
      canonicalNodeItem.activeChildExecutionId || canonicalNodeItem.childExecutionId,
    ),
    runtimeNodeCount: Array.isArray(runtimeNodeSessions?.value)
      ? runtimeNodeSessions.value.length
      : 0,
    fromHistory,
    clickedIdentity: summarizeWorkflowNodeIdentity(nodeItem),
    canonicalIdentity: summarizeWorkflowNodeIdentity(canonicalNodeItem),
    runtimeIdentity: summarizeWorkflowNodeIdentity(canonicalRuntimeNode || {}),
    routeIdentity: route,
  });
}

function prepareOpen(context, nodeItem, options) {
  const { runtimeNodeSessions, workflowPayload, buildWorkflowDrawerRoute } = context;
  const fromHistory = options?.fromHistory === true;
  const traceId = text(options?.traceId) || createWorkflowNodeDetailTraceId();
  const canonicalNodeItem = resolveCanonicalWorkflowNodeItem(nodeItem, runtimeNodeSessions);
  const route = buildWorkflowDrawerRoute(canonicalNodeItem);
  return {
    nodeItem,
    fromHistory,
    traceId,
    canonicalNodeItem,
    canonicalRuntimeNode: resolveRuntimeNodeSession(canonicalNodeItem, runtimeNodeSessions),
    route,
    viewKey: createWorkflowNodeViewKey(canonicalNodeItem, workflowPayload.value),
  };
}

function beginOpen(context, prepared) {
  const { props, translate, flowNodes, refs, pushWorkflowDrawerHistory, nodeViewTransaction } =
    context;
  const { canonicalNodeItem, canonicalRuntimeNode, route, fromHistory, viewKey } = prepared;
  refs.selectedGraphDialogProcessId.value = resolveWorkflowDialogProcessId(canonicalNodeItem);
  logOpenStarted(context, prepared);
  if (!props.userId || !route.rootSessionId || !route.dialogProcessId) {
    ElMessage.warning(translate("workflow.nodeSessionMissing"));
    return null;
  }
  refs.viewerVisible.value = true;
  if (!fromHistory && route.rootSessionId && route.dialogProcessId)
    pushWorkflowDrawerHistory(route);
  refs.viewerError.value = "";
  const owningRuntimeNode = findWorkflowOwningRuntimeNode(canonicalNodeItem, flowNodes?.value);
  if (owningRuntimeNode) refs.selectedRuntimeNode.value = owningRuntimeNode;
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.owningRuntimeNodeResolved", {
    sessionId: resolveIsolatedNodeSessionId(canonicalNodeItem, canonicalRuntimeNode),
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

function resolveProjectionState(prepared, opening, mergeResult) {
  const { canonicalNodeItem, canonicalRuntimeNode } = prepared;
  return (
    mergeResult?.session?.status ||
    canonicalRuntimeNode?.status ||
    canonicalRuntimeNode?.state ||
    opening.owningRuntimeNode?.status ||
    opening.owningRuntimeNode?.state ||
    canonicalNodeItem.status ||
    canonicalNodeItem.state
  );
}

function applyRestSnapshot({
  context,
  prepared,
  opening,
  hydratedDetail,
  sessionIdHint,
  rawMessages,
  mergeResult,
  storedMessages,
}) {
  const { canonicalNodeItem, route } = prepared;
  context.refs.runningPlaceholderViewModel.value = createRunningAssistantPlaceholderViewModel(
    rawMessages,
    {
      sessionId: sessionIdHint,
      turnScopeId: text(canonicalNodeItem.turnScopeId),
      dialogProcessId: route.dialogProcessId,
      state: resolveProjectionState(prepared, opening, mergeResult),
    },
  );
  if (mergeResult?.applied !== true || !mergeResult.session) return;
  context.nodeViewTransaction.replace(opening.viewTicket, {
    ...hydratedDetail,
    messages: storedMessages,
    rawMessages: storedMessages,
    sessionSummary: { ...mergeResult.session, messages: storedMessages },
  });
}

function mergeRestSnapshot(context, prepared, opening, hydratedDetail, sessionIdHint) {
  const { props, applyWorkflowRuntimeEvent } = context;
  const { canonicalNodeItem, route } = prepared;
  const rawMessages = Array.isArray(hydratedDetail.rawMessages) ? hydratedDetail.rawMessages : [];
  const mergeResult =
    typeof applyWorkflowRuntimeEvent === "function"
      ? applyWorkflowRuntimeEvent(hydratedDetail.snapshotEnvelope, { source: "rest_snapshot" })
      : null;
  const storedMessages = Array.isArray(mergeResult?.session?.messages)
    ? mergeResult.session.messages
    : [];
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.subSessionHydrated", {
    sessionId: sessionIdHint,
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    messageCount: rawMessages.length,
    storeMergeAvailable: typeof applyWorkflowRuntimeEvent === "function",
    storeMergeApplied: mergeResult?.applied === true,
    storeMergeReason: text(mergeResult?.reason),
    storedMessageCount: storedMessages.length,
  });
  applyRestSnapshot({
    context,
    prepared,
    opening,
    hydratedDetail,
    sessionIdHint,
    rawMessages,
    mergeResult,
    storedMessages,
  });
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
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.restLoaded", {
    sessionId: text(detail?.sessionId || sessionIdHint),
    dialogProcessId: route.dialogProcessId,
    turnScopeId: text(canonicalNodeItem.turnScopeId),
    workflowRunId: text(canonicalNodeItem.workflowRunId),
    nodeExecutionId: text(canonicalNodeItem.nodeExecutionId),
    requestedSessionId: sessionIdHint,
    responseState: text(detail?.state),
    messageCount: Array.isArray(detail?.messages) ? detail.messages.length : 0,
    executionLogCount: Array.isArray(detail?.executionLogs) ? detail.executionLogs.length : 0,
  });
  if (!isCurrentRequest(nodeViewTransaction, opening.viewTicket, sessionIdHint, detail)) return;
  if (detail?.state === "pending") {
    refs.viewerState.value = "pending";
    return;
  }
  const localExecution =
    executionId && typeof props.selectExecutionDetail === "function"
      ? props.selectExecutionDetail(executionId)?.execution || null
      : null;
  const hydratedDetail = hydrateExecutionSessionDetail(detail, {
    executionId,
    execution: localExecution,
  });
  mergeRestSnapshot(context, prepared, opening, hydratedDetail, sessionIdHint);
  refs.viewerState.value = detail?.state === "empty" ? "empty" : "ready";
}

function recordOpenFailure(context, prepared, opening, identity, error) {
  const { props, refs, nodeViewTransaction, translate } = context;
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.openFailed", {
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
    sessionIdHint: "",
  };
  identity.sessionIdHint = context.resolveExecutionSessionId(
    identity.executionId,
    resolveIsolatedNodeSessionId(prepared.canonicalNodeItem, prepared.canonicalRuntimeNode),
  );
  refs.selectedExecutionId.value = identity.executionId;
  refs.attemptExecutionIds.value = childExecutionIds;
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
  return async function openNodeSession(nodeItem = {}, options = {}) {
    const prepared = prepareOpen(context, nodeItem, options);
    const opening = beginOpen(context, prepared);
    if (!opening) return;
    await openNewProtocolSession(context, prepared, opening);
  };
}
