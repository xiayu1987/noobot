/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";
import {
  resolveIsolatedNodeSessionId,
  resolveRuntimeNodeSession,
} from "./workflowUnifiedSessionDetail.js";
import { workflowSessionText as text } from "./workflowNodeSessionProjection.js";

export function logWorkflowNodeDetailProjection({ props, runtimeNodeSessions }, stage = "", nodeItem = {}, detail = {}) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const executionSessionId = text(detail?.execution?.sessionId || detail?.session?.sessionId || detail?.session?.id);
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const identity = {
    sessionId: text(detail?.sessionId || detail?.sessionSummary?.sessionId),
    dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
    turnScopeId: text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId),
    workflowRunId: text(runtimeNode?.workflowRunId || nodeItem?.workflowRunId),
    nodeExecutionId: text(runtimeNode?.nodeExecutionId || nodeItem?.nodeExecutionId),
    stage,
  };
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.projected", {
    ...identity,
    isolatedNodeSessionId: resolveIsolatedNodeSessionId(nodeItem, runtimeNode),
    executionSessionId,
    messageCount: messages.length,
    messages: messages.map((message = {}) => ({
      id: text(message?.id || message?.messageId), role: text(message?.role),
      sessionId: text(message?.sessionId), turnScopeId: text(message?.turnScopeId),
      dialogProcessId: text(message?.dialogProcessId), pending: message?.pending === true,
      workflowNodeRunningPlaceholder: message?.workflowNodeRunningPlaceholder === true,
      contentLength: String(message?.content || "").length,
    })),
  });
  const projectedAssistants = messages.filter((message = {}) =>
    text(message?.role).toLowerCase() === "assistant" &&
    Boolean(text(message?.statusTurnScopeId) || text(message?.projectedStatusStepState)));
  props.logWorkflowDiagnostics?.("frontend.workflowNodeDetail.statusProjected", {
    ...identity,
    assistantFound: messages.some((message = {}) => text(message?.role).toLowerCase() === "assistant"),
    projectedAssistantCount: projectedAssistants.length,
    projectedAssistants: projectedAssistants.map((message = {}) => ({
      id: text(message?.id || message?.messageId),
      statusTurnScopeId: text(message?.statusTurnScopeId),
      projectedStatusStepState: text(message?.projectedStatusStepState),
    })),
  });
}
