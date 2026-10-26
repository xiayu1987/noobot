/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import {
  resolveIsolatedNodeSessionId,
  resolveRuntimeNodeSession,
} from "./workflowUnifiedSessionDetail.js";
import { text } from "@noobot/shared/value";
let workflowNodeDetailTraceSequence = 0;

export function createWorkflowNodeDetailTraceId() {
  workflowNodeDetailTraceSequence += 1;
  return `workflow-node-detail-${Date.now().toString(36)}-${workflowNodeDetailTraceSequence.toString(36)}`;
}

export function summarizeWorkflowNodeIdentity(node = {}) {
  return {
    nodeSessionId: text(node?.nodeSessionId),
    dialogProcessId: resolveWorkflowDialogProcessId(node),
    turnScopeId: text(node?.turnScopeId),
    workflowRunId: text(node?.workflowRunId),
    nodeExecutionId: text(node?.nodeExecutionId),
    activeChildExecutionId: text(node?.activeChildExecutionId),
  };
}

export function logWorkflowNodeDetailProjection(
  { props, runtimeNodeSessions },
  stage = "",
  nodeItem = {},
  detail = {},
) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const executionSessionId = text(detail?.execution?.sessionId || detail?.session?.sessionId);
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const identity = {
    sessionId: text(detail?.sessionId),
    dialogProcessId: resolveWorkflowDialogProcessId(runtimeNode),
    turnScopeId: text(runtimeNode?.turnScopeId),
    workflowRunId: text(runtimeNode?.workflowRunId),
    nodeExecutionId: text(runtimeNode?.nodeExecutionId),
    stage,
  };
  props.logWorkflowDiagnostics("frontend.workflowNodeDetail.projected", {
    ...identity,
    isolatedNodeSessionId: resolveIsolatedNodeSessionId(runtimeNode),
    executionSessionId,
    subSessionMessageRegistryVersion: props.subSessionMessageRegistryVersion,
    messageCount: messages.length,
    messages: messages.map((message = {}) => ({
      messageUid: text(message?.messageUid),
      presentationMessageId: text(message?.presentationMessageId),
      role: text(message?.role),
      sessionId: text(message?.sessionId),
      turnScopeId: text(message?.turnScopeId),
      dialogProcessId: text(message?.dialogProcessId),
      pending: message?.pending === true,
      contentLength: String(message?.content || "").length,
    })),
  });
}
