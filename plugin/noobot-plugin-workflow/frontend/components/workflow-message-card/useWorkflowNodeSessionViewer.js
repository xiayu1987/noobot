/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
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
import {
  buildUnifiedSessionDetail,
  hasNewProtocolNodeIdentity,
  mergeUnifiedSessionDetail,
  resolveIsolatedNodeSessionId,
  resolveNodeChildExecutionIds,
  resolveRuntimeNodeSession,
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

  function isCurrentSessionRequest(viewTicket, targetSessionId = "", detail = null) {
    if (!nodeViewTransaction.accepts(viewTicket)) return false;
    const expectedSessionId = text(targetSessionId);
    const responseSessionId = detailSessionId(detail || {});
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
  }

  function mergeSelectedNodeSessionSnapshot(detail = {}) {
    const currentSessionId = text(selectedNodeSessionId.value || selectedNodeSessionSummary.value?.sessionId);
    const incomingSessionId = text(detail.sessionId || detail.sessionSummary?.sessionId);
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
    // Repeated Session/Execution snapshots are common at terminal convergence.
    // Do not replace the message tree when the content projection is unchanged.
    if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) return false;
    selectedNodeSessionSummary.value = mergedDetail.sessionSummary || null;
    selectedNodeSessionId.value = mergedDetail.sessionId || "";
    selectedNodeMessages.value = mergedDetail.messages;
    selectedNodeRawMessages.value = mergedDetail.rawMessages;
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
    if (!detail) return false;
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
    // Realtime sub-session events can arrive before the Execution projection.
    const hasMessages = Array.isArray(detail.messages) && detail.messages.length > 0;
    if (hasMessages || detail.execution) viewerState.value = "streaming";
    return true;
  }

  async function openNodeSession(nodeItem = {}, options = {}) {
    const { fromHistory = false } = options || {};
    const viewKey = nodeViewKey(nodeItem);
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
    viewerError.value = "";
    selectedRuntimeStep.value = nodeItem;
    selectedNode.value = nodeItem;
    const viewTicket = nodeViewTransaction.begin(viewKey);
    viewerState.value = "loading";
    if (isNewProtocolNode) {
      // The node's committed Child Execution reference is authoritative. Do
      // not wait for its Execution/message projection to already exist in the
      // local registry: that is precisely when the drawer needs to hydrate it.
      const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
      const executionId = text(selectedExecutionId.value || childExecutionIds[0]);
      const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
      const sessionIdHint = resolveIsolatedNodeSessionId(nodeItem, runtimeNode);
      selectedExecutionId.value = executionId;
      attemptExecutionIds.value = childExecutionIds;
      try {
        // A local Execution projection is intentionally treated as a live,
        // sparse projection. Always hydrate its isolated Session through the
        // full-detail endpoint as well, so user prompts, turn status/timing and
        // persisted thinking facts are present before realtime deltas merge.
        if (sessionIdHint) {
          const detail = await fetchExecutionSessionDetail({
            props,
            translate,
            sessionId: sessionIdHint,
            rootSessionId,
            dialogProcessId,
          });
          if (isCurrentSessionRequest(viewTicket, sessionIdHint, detail)) {
            if (detail?.state === "pending") {
              viewerState.value = "pending";
            } else {
              nodeViewTransaction.replace(viewTicket, hydrateExecutionSessionDetail(detail, {
                executionId,
                execution: executionId && typeof props.selectExecutionDetail === "function"
                  ? props.selectExecutionDetail(executionId)?.execution || null
                  : null,
              }));
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
          // Neither authoritative identity has reached the client yet.
          viewerState.value = "pending";
        }
      } catch (error) {
        if (nodeViewTransaction.accepts(viewTicket)) {
          viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
          viewerState.value = "failed";
        }
      } finally {
        if (nodeViewTransaction.activate(viewTicket)) {
          applyUnifiedSessionDetailIfAvailable(nodeItem);
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
      const targetSessionId = text(nodeItem?.sessionId || nodeItem?.nodeSessionId);
      if (!isCurrentSessionRequest(viewTicket, targetSessionId, detail)) return;
      nodeViewTransaction.replace(viewTicket, detail);
      viewerState.value = (detail.messages || []).length ? "ready" : "empty";
    } catch (error) {
      if (!nodeViewTransaction.accepts(viewTicket)) return;
      viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
      viewerState.value = "failed";
    } finally {
      if (nodeViewTransaction.activate(viewTicket)) {
        applyUnifiedSessionDetailIfAvailable(nodeItem);
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
  }

  async function handleRuntimeStepClick(stepItem = {}) {
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

  // Track content sources in the watch getter and commit in the callback.
  // A watchEffect used to read selected refs while merging and then write the
  // same refs, creating a self-triggering projection loop at workflow finish.
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
