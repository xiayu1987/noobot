/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { shouldRejectRootSessionProjection } from "../../runtime/workflowNodeSessionIdentity.js";
import { mergeUnifiedSessionDetail } from "../../runtime/workflowUnifiedSessionDetail.js";
import { resolveWorkflowDialogProcessId } from "../../utils/workflowDialogProcessId.js";

const text = (value) => String(value || "").trim();

function comparableSnapshot({ refs, sessionId = "", detail = null }) {
  if (detail) {
    return {
      sessionId: detail.sessionId || "",
      sessionSummary: detail.sessionSummary || null,
      messages: detail.messages,
      rawMessages: detail.rawMessages,
    };
  }
  return {
    sessionId,
    sessionSummary: refs.selectedNodeSessionSummary.value || null,
    messages: refs.selectedNodeMessages.value,
    rawMessages: refs.selectedNodeRawMessages.value,
  };
}

function assignSnapshot(refs, detail = {}) {
  refs.selectedNodeSessionSummary.value = detail.sessionSummary || null;
  refs.selectedNodeSessionId.value = detail.sessionId || "";
  refs.selectedNodeMessages.value = detail.messages;
  refs.selectedNodeRawMessages.value = detail.rawMessages;
  refs.runningPlaceholderViewModel.value = detail.runningPlaceholderViewModel || null;
}

export function createSessionSnapshotController({ props, refs, buildWorkflowDrawerRoute }) {
  function reset() {
    refs.selectedNodeMessages.value = [];
    refs.selectedNodeRawMessages.value = [];
    refs.selectedNodeSessionSummary.value = null;
    refs.selectedNodeSessionId.value = "";
    refs.runningPlaceholderViewModel.value = null;
    refs.selectedExecutionId.value = "";
    refs.executionDirectory.value = [];
    refs.attemptExecutionIds.value = [];
    refs.viewerState.value = "idle";
  }

  function logSnapshot(event, data = {}) {
    const node = refs.selectedNode.value || {};
    props.logWorkflowDiagnostics?.(event, {
      sessionId: refs.selectedNodeSessionId.value,
      dialogProcessId: resolveWorkflowDialogProcessId(node),
      turnScopeId: text(node.turnScopeId),
      workflowRunId: text(node.workflowRunId),
      messageCount: refs.selectedNodeMessages.value.length,
      ...data,
    });
  }

  function replace(detail = {}) {
    assignSnapshot(refs, mergeUnifiedSessionDetail({}, detail));
    logSnapshot("frontend.workflowNodeDetail.snapshotReplaced");
  }

  function merge(detail = {}) {
    const currentSessionId = text(
      refs.selectedNodeSessionId.value || refs.selectedNodeSessionSummary.value?.sessionId,
    );
    const incomingSessionId = text(detail.sessionId || detail.sessionSummary?.sessionId);
    const rootSessionId = text(
      buildWorkflowDrawerRoute(refs.selectedNode.value || {}).rootSessionId,
    );
    if (shouldRejectRootSessionProjection({ currentSessionId, incomingSessionId, rootSessionId })) {
      logSnapshot("frontend.workflowNodeDetail.rootProjectionRejected", {
        sessionId: rootSessionId,
        currentSessionId,
        incomingSessionId,
        messageCount: Array.isArray(detail.messages) ? detail.messages.length : 0,
      });
      return false;
    }
    const currentDetail =
      currentSessionId && currentSessionId === incomingSessionId
        ? comparableSnapshot({ refs, sessionId: currentSessionId })
        : {};
    const mergedDetail = mergeUnifiedSessionDetail(currentDetail, detail);
    if (
      JSON.stringify(comparableSnapshot({ refs, sessionId: currentSessionId })) ===
      JSON.stringify(comparableSnapshot({ refs, detail: mergedDetail }))
    ) {
      return false;
    }
    assignSnapshot(refs, mergedDetail);
    logSnapshot("frontend.workflowNodeDetail.snapshotMerged", {
      previousSessionId: currentSessionId,
      incomingSessionId,
    });
    return true;
  }

  return { reset, replace, merge };
}
