/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
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
  let nodeSessionRequestToken = 0;
  const selectedExecutionId = ref("");
  const executionDirectory = ref([]);
  const attemptExecutionIds = ref([]);

  function detailSessionId(detail = {}) {
    return text(detail?.sessionId || detail?.sessionSummary?.sessionId || detail?.session?.sessionId || detail?.session?.id);
  }

  function isCurrentSessionRequest(requestToken, targetSessionId = "", detail = null) {
    if (requestToken !== nodeSessionRequestToken) return false;
    const expectedSessionId = text(targetSessionId);
    const responseSessionId = detailSessionId(detail || {});
    if (expectedSessionId && responseSessionId && expectedSessionId !== responseSessionId) return false;
    const selectedTargetSessionId = text(
      selectedNode.value?.sessionId || selectedNode.value?.nodeSessionId,
    );
    return !expectedSessionId || !selectedTargetSessionId || expectedSessionId === selectedTargetSessionId;
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
    applySelectedNodeSessionDetail({
      sessionId: text(execution.sessionId || session.sessionId || session.id),
      messages,
      rawMessages: messages,
      sessionSummary: {
        ...session,
        executionId: id,
        turnRuntime: execution,
        messages,
      },
    });
    return true;
  }

  async function loadExecutionSessionDetail(
    executionId = "",
    requestToken = nodeSessionRequestToken,
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
    if (!isCurrentSessionRequest(requestToken, sessionId, detail)) return { state: "stale" };
    if (detail?.state === "pending") return detail;
    applySelectedNodeSessionDetail(hydrateExecutionSessionDetail(detail, {
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

  function applySelectedNodeSessionDetail(detail = {}) {
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
    selectedNodeSessionSummary.value = mergedDetail.sessionSummary || null;
    selectedNodeSessionId.value = mergedDetail.sessionId || "";
    selectedNodeMessages.value = mergedDetail.messages;
    selectedNodeRawMessages.value = mergedDetail.rawMessages;
    if (typeof mergeSubSessionSnapshot === "function") {
      mergeSubSessionSnapshot({
        ...mergedDetail.sessionSummary,
        sessionId: mergedDetail.sessionId,
        messages: mergedDetail.messages,
        rawMessages: mergedDetail.rawMessages,
      });
    }
  }

  function applyUnifiedSessionDetailIfAvailable(nodeItem = selectedNode.value || {}) {
    if (!viewerVisible.value || !selectedNode.value) return false;
    const detail = buildUnifiedSessionDetail({
      nodeItem,
      runtimeNodeSessions,
      selectSessionMessages: props.selectSessionMessages,
      selectExecutionDetail: props.selectExecutionDetail,
      turnRuntimeRegistry: props.turnRuntimeRegistry,
      allowEmptyMessages: false,
    });
    if (!detail) return false;
    applySelectedNodeSessionDetail(detail);
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
    // Once either messages or a live turn projection is available, leave the
    // passive pending placeholder and let AgentExecutionView replay/stream it.
    const hasMessages = Array.isArray(detail.messages) && detail.messages.length > 0;
    const hasRuntime = Boolean(detail.execution || detail.sessionSummary?.turnRuntime);
    if (hasMessages || hasRuntime) viewerState.value = "streaming";
    return true;
  }

  function bindSelectedNodeRealtimeProjection(nodeItem = selectedNode.value || {}) {
    const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
    const sessionId = resolveIsolatedNodeSessionId(nodeItem, runtimeNode);
    if (!sessionId || typeof props.selectSessionMessages !== "function") return false;
    const sessionDoc = props.selectSessionMessages(sessionId);
    if (!sessionDoc || typeof sessionDoc !== "object") return false;
    applySelectedNodeSessionDetail({
      sessionId,
      sessionSummary: sessionDoc,
      messages: Array.isArray(sessionDoc.messages) ? sessionDoc.messages : [],
      rawMessages: Array.isArray(sessionDoc.rawMessages) ? sessionDoc.rawMessages : sessionDoc.messages,
    });
    return true;
  }

  async function openNodeSession(nodeItem = {}, options = {}) {
    const { fromHistory = false } = options || {};
    const requestToken = ++nodeSessionRequestToken;
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
    viewerLoading.value = true;
    viewerState.value = "loading";
    viewerError.value = "";
    selectedNode.value = nodeItem;
    resetSelectedNodeSession();
    bindSelectedNodeRealtimeProjection(nodeItem);
    if (isNewProtocolNode) {
      applyUnifiedSessionDetailIfAvailable(nodeItem);
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
          if (isCurrentSessionRequest(requestToken, sessionIdHint, detail)) {
            if (detail?.state === "pending") {
              viewerState.value = "pending";
            } else {
              applySelectedNodeSessionDetail(hydrateExecutionSessionDetail(detail, {
                executionId,
                execution: executionId && typeof props.selectExecutionDetail === "function"
                  ? props.selectExecutionDetail(executionId)?.execution || null
                  : null,
              }));
              viewerState.value = detail?.state === "empty" ? "empty" : "ready";
            }
          }
        } else if (executionId) {
          const result = await loadExecutionSessionDetail(executionId, requestToken, { sessionIdHint });
          if (requestToken === nodeSessionRequestToken && result.state !== "stale") {
            viewerState.value = result.state;
          }
          if (result.state === "failed" && requestToken === nodeSessionRequestToken) {
            viewerError.value = translate("workflow.readNodeSessionFailed");
          }
        } else if (requestToken === nodeSessionRequestToken) {
          // Neither authoritative identity has reached the client yet.
          viewerState.value = "pending";
        }
      } catch (error) {
        if (requestToken === nodeSessionRequestToken) {
          viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
          viewerState.value = "failed";
        }
      } finally {
        if (requestToken === nodeSessionRequestToken) viewerLoading.value = false;
      }
      return;
    }
    if (!rootSessionId || !dialogProcessId) {
      viewerLoading.value = false;
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
      if (!isCurrentSessionRequest(requestToken, targetSessionId, detail)) return;
      applySelectedNodeSessionDetail(detail);
      applyUnifiedSessionDetailIfAvailable(nodeItem);
      viewerState.value = (detail.messages || []).length ? "ready" : "empty";
    } catch (error) {
      if (requestToken !== nodeSessionRequestToken) return;
      viewerError.value = String(error?.message || error || translate("workflow.readNodeSessionFailed"));
      viewerState.value = "failed";
    } finally {
      if (requestToken === nodeSessionRequestToken) {
        viewerLoading.value = false;
      }
    }
  }

  function openWorkflowNodePanel(nodeItem = {}) {
    nodeSessionRequestToken += 1;
    selectedRuntimeNode.value = nodeItem;
    selectedRuntimeStep.value = null;
    selectedNode.value = nodeItem;
    selectedGraphDialogProcessId.value = "";
    resetSelectedNodeSession();
    viewerError.value = "";
    viewerLoading.value = false;
    viewerState.value = "idle";
    viewerVisible.value = true;
  }

  async function handleRuntimeStepClick(stepItem = {}) {
    if (!stepHasSession(stepItem)) return;
    selectedRuntimeStep.value = stepItem;
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
      replaceWorkflowDrawerHistory({ dialogProcessId: "", rootSessionId: "" });
    },
  );

  watchEffect(() => {
    if (!viewerVisible.value || !selectedNode.value) return;
    // Selector functions close over Pinia state, but invoking them alone does
    // not give this plugin effect a reactive dependency after props have been
    // unwrapped. The host-provided token changes with Execution/Turn/session
    // projections and makes completion snapshots re-enter this merge path.
    void props.workflowRuntimeProjectionVersion;
    if (!applyUnifiedSessionDetailIfAvailable(selectedNode.value)) {
      bindSelectedNodeRealtimeProjection(selectedNode.value);
    }
  });

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
