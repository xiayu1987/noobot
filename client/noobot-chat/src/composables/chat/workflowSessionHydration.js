/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function text(value) {
  return String(value || "").trim();
}

function workflowPayload(message = {}) {
  return message?.pluginMeta?.payload && typeof message.pluginMeta.payload === "object"
    ? message.pluginMeta.payload
    : {};
}

export function workflowPlanningEventFromMessage(message = {}, fallbackSessionId = "") {
  if (text(message?.type) !== "workflow") return null;
  const payload = workflowPayload(message);
  const execution = payload?.execution && typeof payload.execution === "object" ? payload.execution : {};
  const workflowRunId = text(
    payload.workflowRunId || execution.workflowRunId || execution.instanceId ||
    message.workflowRunId || message.turnScopeId,
  );
  const nodeSessions = Array.isArray(payload.nodeSessions)
    ? payload.nodeSessions
    : (Array.isArray(execution.nodeAgentRuns) ? execution.nodeAgentRuns : []);
  if (!workflowRunId || !nodeSessions.length) return null;
  return {
    workflowRunId,
    sessionId: text(payload?.planningDialog?.sessionId || fallbackSessionId),
    dialogProcessId: text(payload?.planningDialog?.dialogProcessId || message.dialogProcessId),
    turnScopeId: text(message.turnScopeId || workflowRunId),
    semanticText: text(message.content || payload.semanticText || payload?.interaction?.semanticTextPreview),
    createdAt: message.ts || message.createdAt || "",
    nodeSessions,
  };
}

export function hydrateWorkflowRegistryFromSessionDetail({
  detail = {},
  sessionItem = {},
  mainSessionDoc = {},
  upsertWorkflowPlanningEvent,
} = {}) {
  if (typeof upsertWorkflowPlanningEvent !== "function") return 0;
  const sessionId = text(
    mainSessionDoc?.sessionId || detail?.sessionId || sessionItem?.backendSessionId || sessionItem?.id,
  );
  const sources = [
    ...(Array.isArray(mainSessionDoc?.messages) ? mainSessionDoc.messages : []),
    ...(Array.isArray(detail?.messages) ? detail.messages : []),
    ...(Array.isArray(sessionItem?.detailMessages) ? sessionItem.detailMessages : []),
  ];
  const seen = new Set();
  let hydrated = 0;
  for (const message of sources) {
    const event = workflowPlanningEventFromMessage(message, sessionId);
    if (!event || seen.has(event.workflowRunId)) continue;
    seen.add(event.workflowRunId);
    upsertWorkflowPlanningEvent(event);
    hydrated += 1;
  }
  return hydrated;
}

export function isWorkflowThinkingPlaceholder(message = {}, workflowRegistry = {}, persistedMessages = []) {
  if (text(message?.role).toLowerCase() !== "assistant") return false;
  if (text(message?.type || message?.messageType) !== "message") return false;
  if (text(message?.content)) return false;
  const turnScopeId = text(message?.turnScopeId);
  const dialogProcessId = text(message?.dialogProcessId);
  if (!turnScopeId && !dialogProcessId) return false;
  const matchingWorkflow = Object.values(workflowRegistry?.workflows || {}).find((workflow = {}) =>
    (turnScopeId && text(workflow.turnScopeId) === turnScopeId) ||
    (!turnScopeId && dialogProcessId && text(workflow.dialogProcessId) === dialogProcessId));
  if (!matchingWorkflow) return false;

  // The empty assistant entity is also the live thinking surface. Retiring it
  // merely because a realtime planning event exists removes the entire panel
  // while the turn is still running. It is safe to hide only after the same
  // turn has an actual persisted workflow entity which can replace that
  // surface (the refresh/session-detail case).
  return (Array.isArray(persistedMessages) ? persistedMessages : []).some((candidate = {}) => {
    if (text(candidate?.type || candidate?.messageType) !== "workflow") return false;
    const payload = workflowPayload(candidate);
    const execution = payload?.execution && typeof payload.execution === "object" ? payload.execution : {};
    const candidateRunId = text(
      payload.workflowRunId || execution.workflowRunId || execution.instanceId ||
      candidate.workflowRunId || candidate.turnScopeId,
    );
    const candidateTurnScopeId = text(candidate?.turnScopeId);
    const candidateDialogProcessId = text(candidate?.dialogProcessId || payload?.planningDialog?.dialogProcessId);
    return Boolean(
      (candidateRunId && candidateRunId === text(matchingWorkflow.workflowRunId)) ||
      (turnScopeId && candidateTurnScopeId === turnScopeId) ||
      (!turnScopeId && dialogProcessId && candidateDialogProcessId === dialogProcessId),
    );
  });
}
