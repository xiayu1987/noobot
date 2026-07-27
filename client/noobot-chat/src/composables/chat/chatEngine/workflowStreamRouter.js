/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function routeWorkflowStreamEvent(event, data, context) {
  const {
    applyWorkflowRuntimeEvent, logSessionEvent, sessionId, turnScopeId,
    upsertWorkflowNodeStateEvent, upsertWorkflowPlanningEvent,
  } = context;
  if (event === "workflow_node_state_committed") {
    logSessionEvent({
      category: "debug", level: "debug", debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.nodeStateReceived",
      sessionId: data?.parentSessionId || data?.sessionId || sessionId,
      dialogProcessId: data?.dialogProcessId || "", turnScopeId: data?.turnScopeId || turnScopeId,
      data: {
        workflowRunId: String(data?.workflowRunId || ""), nodeExecutionId: String(data?.nodeExecutionId || ""),
        status: String(data?.status || ""), revision: Number(data?.revision || 0),
        sequence: Number(data?.sequence || 0), dataKeys: Object.keys(data || {}).sort(),
      },
    });
    if (typeof applyWorkflowRuntimeEvent === "function") {
      applyWorkflowRuntimeEvent({ event, data: data || {}, transportSequence: Number(data?.seq || 0) }, { source: "live" });
    } else upsertWorkflowNodeStateEvent?.(data || {});
    return true;
  }
  if (event === "workflow_planning_message_prepared") {
    logSessionEvent({
      category: "debug", level: "debug", debugType: "workflow-diagnostics",
      event: "frontend.workflowTransport.planningReceived",
      sessionId: data?.sessionId || sessionId, dialogProcessId: data?.dialogProcessId || "",
      turnScopeId: data?.turnScopeId || turnScopeId,
      data: {
        workflowRunId: String(data?.workflowRunId || ""),
        nodeSessionCount: Array.isArray(data?.nodeSessions) ? data.nodeSessions.length : 0,
        semanticTextLength: String(data?.semanticText || "").length, dataKeys: Object.keys(data || {}).sort(),
      },
    });
    if (typeof applyWorkflowRuntimeEvent === "function") {
      applyWorkflowRuntimeEvent({ event, data: data || {}, transportSequence: Number(data?.seq || 0) }, { source: "live" });
    } else upsertWorkflowPlanningEvent?.(data || {});
    return true;
  }
  return false;
}
