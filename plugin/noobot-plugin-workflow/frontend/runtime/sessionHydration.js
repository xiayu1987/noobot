/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function summarizeWorkflowMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message, index) => ({
    index,
    id: String(message?.id || message?.messageId || ""),
    type: String(message?.type || ""),
    pluginSource: String(message?.pluginMeta?.source || ""),
    turnScopeId: String(message?.turnScopeId || ""),
  })).filter((message) => message.type === "workflow" || message.pluginSource === "workflow-plugin");
}

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
  applyWorkflowRuntimeEvent,
  turnRuntimeRegistry = {},
  isTurnRuntimeDeleted = () => false,
  logRuntimeDiagnostic = () => {},
} = {}) {
  const logWorkflowDiagnostics = (event, payload) => logRuntimeDiagnostic(event, payload);
  if (typeof applyWorkflowRuntimeEvent !== "function") {
    logWorkflowDiagnostics("frontend.workflowHydration.skipped", {
      sessionId: text(detail?.sessionId || sessionItem?.backendSessionId || sessionItem?.id),
      reason: "missing_upsert",
    });
    return 0;
  }
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
  const runtimeEvents = Array.isArray(detail?.workflowRuntimeEvents)
    ? detail.workflowRuntimeEvents
    : [];
  const rejectedWorkflowRunIds = new Set();
  const isDeletedPlanning = (data = {}) => isTurnRuntimeDeleted(turnRuntimeRegistry, {
    sessionId: text(data?.sessionId || sessionId),
    turnScopeId: text(data?.turnScopeId),
  });
  const rejectRuntimeEvent = (runtimeEvent = {}) => {
    const eventName = text(runtimeEvent?.event || runtimeEvent?.type);
    const data = runtimeEvent?.data && typeof runtimeEvent.data === "object"
      ? runtimeEvent.data
      : runtimeEvent;
    const workflowRunId = text(data?.workflowRunId);
    return (
      (eventName === "workflow_planning_message_prepared" && isDeletedPlanning(data)) ||
      (workflowRunId && rejectedWorkflowRunIds.has(workflowRunId))
    );
  };
  const reduceRuntimeEvent = (record = {}, source = "replay") =>
    applyWorkflowRuntimeEvent(record, { source });
  logWorkflowDiagnostics("frontend.workflowHydration.sourceInspected", {
    sessionId,
    sourceMessageCount: sources.length,
    workflowCandidates: summarizeWorkflowMessages(sources),
    workflowRuntimeEventCount: runtimeEvents.length,
  });
  for (const runtimeEvent of runtimeEvents) {
    const eventName = text(runtimeEvent?.event || runtimeEvent?.type);
    const data = runtimeEvent?.data && typeof runtimeEvent.data === "object"
      ? runtimeEvent.data
      : runtimeEvent;
    if (eventName !== "workflow_planning_message_prepared" || !isDeletedPlanning(data)) continue;
    const workflowRunId = text(data?.workflowRunId);
    if (workflowRunId) rejectedWorkflowRunIds.add(workflowRunId);
  }
  for (const runtimeEvent of runtimeEvents) {
    const eventName = text(runtimeEvent?.event || runtimeEvent?.type);
    const data = runtimeEvent?.data && typeof runtimeEvent.data === "object"
      ? runtimeEvent.data
      : runtimeEvent;
    if (!["workflow_planning_message_prepared", "workflow_node_state_committed", "workflow_message_event"].includes(eventName)) continue;
    if (rejectRuntimeEvent(runtimeEvent)) {
      logWorkflowDiagnostics("frontend.workflowHydration.runtimeEventRejected", {
        sessionId,
        dialogProcessId: text(data?.dialogProcessId),
        turnScopeId: text(data?.turnScopeId),
        workflowRunId: text(data?.workflowRunId),
        eventName,
        reason: "deleted_turn_tombstoned",
      });
      continue;
    }
    const result = reduceRuntimeEvent(runtimeEvent, "replay");
    if (eventName !== "workflow_planning_message_prepared") continue;
    const workflowRunId = text(data?.workflowRunId);
    if (workflowRunId) seen.add(workflowRunId);
    hydrated += workflowRunId ? 1 : 0;
    logWorkflowDiagnostics("frontend.workflowHydration.runtimePlanningApplied", {
      sessionId,
      dialogProcessId: text(data?.dialogProcessId),
      turnScopeId: text(data?.turnScopeId),
      workflowRunId,
      nodeSessionCount: Array.isArray(data?.nodeSessions) ? data.nodeSessions.length : 0,
      sequenceDomain: text(runtimeEvent?.sequenceDomain || data?.sequenceDomain),
      applied: result?.applied === true,
      reason: String(result?.reason || ""),
    });
  }
  logWorkflowDiagnostics("frontend.workflowHydration.completed", {
    sessionId,
    hydratedWorkflowCount: hydrated,
    sourceMessageCount: sources.length,
  });
  return hydrated;
}
