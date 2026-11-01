/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { mergeCanonicalSessionDetail } from "noobot-chat/plugin-api/session-domain";
import { isTerminalTurnState } from "@noobot/session-protocol/turn-lifecycle";
import {
  isWorkflowNodeTerminalStatus,
  selectWorkflowNodeChildExecutionIds,
} from "@noobot/event-protocol/workflow-runtime-event";
import { requireWorkflowDetailIdentity } from "@noobot/event-protocol/workflow-session-detail";
import { requireSessionContentProjection } from "@noobot/session-protocol/session-detail";
import {
  requireSelectedExecutionDetail,
  requireSelectedSessionDocument,
} from "@noobot/plugin-protocol/frontend";

function contentOnly(value) {
  const { turnRuntime: _turnRuntime, ...content } = value;
  return content;
}

export function projectSessionMetadata(sessionDoc) {
  requireSelectedSessionDocument(sessionDoc, sessionDoc.sessionId);
  const {
    turnRuntime: _turnRuntime,
    sessionId: _sessionId,
    messages: _messages,
    turnTimings: _turnTimings,
    ...metadata
  } = sessionDoc;
  return metadata;
}

export function isTerminalExecutionProjection(execution) {
  return isTerminalTurnState(execution.state);
}

export function isWorkflowNodeRunning(runtimeNode) {
  return !isWorkflowNodeTerminalStatus(runtimeNode.status);
}

function createTurnMessageMatcher(turnScopeId) {
  return (item) => item.turnScopeId === turnScopeId;
}

function findTurnRoleMessage(messages, role, matchesTurn) {
  return messages.find((item) => item.role === role && matchesTurn(item));
}

function buildRunningPlaceholderIdentity({ sessionId, scopeId, dialogProcessId }) {
  return {
    viewKey: `workflow-node-running:${sessionId}:${scopeId}`,
    sessionId,
    turnScopeId: scopeId,
    dialogProcessId,
  };
}

export function createRunningAssistantPlaceholderViewModel(
  messages,
  { sessionId, turnScopeId, running },
) {
  if (!running) return null;
  requireWorkflowDetailIdentity(sessionId, "sessionId");
  const scopeId = requireWorkflowDetailIdentity(turnScopeId, "turnScopeId");
  const matchesTurn = createTurnMessageMatcher(scopeId);
  const matchingUser = findTurnRoleMessage(messages, "user", matchesTurn);
  if (!matchingUser) return null;
  if (findTurnRoleMessage(messages, "assistant", matchesTurn)) return null;
  if (Object.hasOwn(matchingUser, "sessionId") && matchingUser.sessionId !== sessionId) {
    throw new TypeError("workflow placeholder message belongs to another session");
  }
  return buildRunningPlaceholderIdentity({
    sessionId,
    scopeId,
    dialogProcessId: matchingUser.dialogProcessId,
  });
}

export function mergeUnifiedSessionDetail(base, incoming) {
  const merged = mergeCanonicalSessionDetail(
    contentOnly(requireSessionContentProjection(base)),
    contentOnly(requireSessionContentProjection(incoming)),
  );
  return {
    ...contentOnly(merged),
    ...(merged.execution ? { execution: contentOnly(merged.execution) } : {}),
  };
}

export function resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  return selectWorkflowNodeChildExecutionIds(runtimeNode);
}

export function resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions) {
  const nodeExecutionId = requireWorkflowDetailIdentity(
    nodeItem.nodeExecutionId,
    "nodeExecutionId",
  );
  const runtimeNode = runtimeNodeSessions.value.find(
    (item) => item.nodeExecutionId === nodeExecutionId,
  );
  if (!runtimeNode) throw new Error(`workflow runtime node not found: ${nodeExecutionId}`);
  return runtimeNode;
}

export function resolveIsolatedNodeSessionId(runtimeNode) {
  if (runtimeNode.nodeSessionId === "") return "";
  return requireWorkflowDetailIdentity(runtimeNode.nodeSessionId, "nodeSessionId");
}

function buildExecutionSessionMetadata({ sessionDoc, executionId, turnScopeId, dialogProcessId }) {
  return {
    ...projectSessionMetadata(sessionDoc),
    executionId,
    turnScopeId,
    dialogProcessId,
  };
}

function buildExecutionDetailProjection({ childExecutionIds, executionDetail }) {
  const execution = contentOnly(executionDetail.execution);
  const sessionDoc = contentOnly(executionDetail.session);
  const { sessionId, executionId, turnScopeId, dialogProcessId } = execution;
  const { messages } = sessionDoc;
  return {
    executionId,
    execution,
    childExecutions: executionDetail.children,
    descendantExecutions: executionDetail.descendants,
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(messages, {
      sessionId,
      turnScopeId,
      running: !isTerminalExecutionProjection(execution),
    }),
    sessionMetadata: buildExecutionSessionMetadata({
      sessionDoc,
      executionId,
      turnScopeId,
      dialogProcessId,
    }),
  };
}

function selectScopedMessages(messages, turnScopeId) {
  return messages.filter((message) => message.turnScopeId === turnScopeId);
}

function buildIsolatedSessionProjection({
  runtimeNode,
  childExecutionIds,
  isolatedNodeSessionId,
  selectSessionMessages,
}) {
  if (!isolatedNodeSessionId) return null;
  const sessionDoc = requireSelectedSessionDocument(
    selectSessionMessages(isolatedNodeSessionId),
    isolatedNodeSessionId,
  );
  if (sessionDoc === null) return null;
  const { messages } = sessionDoc;
  const turnScopeId = requireWorkflowDetailIdentity(runtimeNode.turnScopeId, "turnScopeId");
  const scopedMessages = selectScopedMessages(messages, turnScopeId);
  const dialogProcessId = resolveWorkflowDialogProcessId(runtimeNode);
  return {
    executionId: childExecutionIds.length ? childExecutionIds[0] : "",
    attemptExecutionIds: childExecutionIds,
    sessionId: isolatedNodeSessionId,
    messages: scopedMessages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(scopedMessages, {
      sessionId: isolatedNodeSessionId,
      turnScopeId,
      running: isWorkflowNodeRunning(runtimeNode),
    }),
    sessionMetadata: {
      ...projectSessionMetadata(sessionDoc),
      dialogProcessId,
      turnScopeId,
    },
  };
}

export function buildUnifiedSessionDetail({
  nodeItem,
  runtimeNodeSessions,
  selectSessionMessages,
  selectExecutionDetail,
}) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const isolatedNodeSessionId = resolveIsolatedNodeSessionId(runtimeNode);
  const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
  if (childExecutionIds.length) {
    const executionDetail = requireSelectedExecutionDetail(
      selectExecutionDetail(childExecutionIds[0]),
      {
        executionId: childExecutionIds[0],
        sessionId: isolatedNodeSessionId || undefined,
      },
    );
    if (executionDetail !== null) {
      return buildExecutionDetailProjection({
        childExecutionIds,
        executionDetail,
      });
    }
  }
  return buildIsolatedSessionProjection({
    runtimeNode,
    childExecutionIds,
    isolatedNodeSessionId,
    selectSessionMessages,
  });
}
