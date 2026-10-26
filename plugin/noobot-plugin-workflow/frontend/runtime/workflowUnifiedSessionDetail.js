/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { mergeCanonicalSessionDetail } from "noobot-chat/plugin-api/session-domain";
import { isTerminalTurnState } from "@noobot/session-protocol/turn-lifecycle";
import { isWorkflowNodeTerminalStatus } from "@noobot/event-protocol/workflow-runtime-event";
import { text } from "@noobot/shared/value";

function contentOnly(value = {}) {
  const { turnRuntime: _turnRuntime, ...content } = value && typeof value === "object" ? value : {};
  return content;
}

export function projectSessionMetadata(sessionDoc = {}) {
  const {
    turnRuntime: _turnRuntime,
    sessionId: _sessionId,
    messages: _messages,
    turnTimings: _turnTimings,
    ...metadata
  } = sessionDoc && typeof sessionDoc === "object" ? sessionDoc : {};
  return metadata;
}

export function isTerminalExecutionProjection(execution) {
  return isTerminalTurnState(execution.state);
}

export function isWorkflowNodeRunning(runtimeNode) {
  return !isWorkflowNodeTerminalStatus(runtimeNode.status);
}

function createTurnMessageMatcher(turnScopeId, dialogProcessId) {
  return (item = {}) => {
    const itemScopeId = text(item?.turnScopeId || item?.metadata?.turnScopeId);
    const itemDialogId = text(item?.dialogProcessId || item?.metadata?.dialogProcessId);
    if (turnScopeId && itemScopeId) return itemScopeId === turnScopeId;
    if (dialogProcessId && itemDialogId) return itemDialogId === dialogProcessId;
    return !turnScopeId && !dialogProcessId;
  };
}

function findTurnRoleMessage(messages, role, matchesTurn) {
  return messages.find((item = {}) => text(item?.role).toLowerCase() === role && matchesTurn(item));
}

function buildRunningPlaceholderIdentity(matchingUser, { sessionId, scopeId, dialogProcessId }) {
  return {
    viewKey: `workflow-node-running:${scopeId || dialogProcessId || text(sessionId)}`,
    sessionId: text(matchingUser?.sessionId || matchingUser?.metadata?.sessionId || sessionId),
    turnScopeId: scopeId,
    dialogProcessId: text(
      matchingUser?.dialogProcessId || matchingUser?.metadata?.dialogProcessId || dialogProcessId,
    ),
  };
}

export function createRunningAssistantPlaceholderViewModel(
  messages,
  { sessionId, turnScopeId, dialogProcessId, running },
) {
  if (!running) return null;
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  const matchesTurn = createTurnMessageMatcher(scopeId, normalizedDialogProcessId);
  const matchingUser = findTurnRoleMessage(messages, "user", matchesTurn);
  if (!matchingUser) return null;
  if (findTurnRoleMessage(messages, "assistant", matchesTurn)) return null;
  return buildRunningPlaceholderIdentity(matchingUser, {
    sessionId,
    scopeId,
    dialogProcessId: normalizedDialogProcessId,
  });
}

export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const merged = mergeCanonicalSessionDetail(contentOnly(base), contentOnly(incoming));
  return {
    ...contentOnly(merged),
    ...(merged.execution ? { execution: contentOnly(merged.execution) } : {}),
  };
}

export function resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const attempts = Array.isArray(runtimeNode.attemptExecutionIds)
    ? runtimeNode.attemptExecutionIds
    : [];
  return Array.from(new Set([runtimeNode.activeChildExecutionId, ...attempts].filter(Boolean)));
}

export function resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions) {
  const nodeExecutionId = text(nodeItem.nodeExecutionId);
  if (!nodeExecutionId) throw new Error("workflow runtime node requires nodeExecutionId");
  const runtimeNode = runtimeNodeSessions.value.find(
    (item) => item.nodeExecutionId === nodeExecutionId,
  );
  if (!runtimeNode) throw new Error(`workflow runtime node not found: ${nodeExecutionId}`);
  return runtimeNode;
}

export function resolveIsolatedNodeSessionId(runtimeNode) {
  return text(runtimeNode.nodeSessionId);
}

function resolveDialogProcessId(runtimeNode, execution = {}) {
  return text(execution.dialogProcessId || resolveWorkflowDialogProcessId(runtimeNode));
}

function selectIsolatedSessionDocument(isolatedNodeSessionId, selectSessionMessages) {
  if (!isolatedNodeSessionId) return {};
  return contentOnly(selectSessionMessages(isolatedNodeSessionId) || {});
}

function selectExecutionSessionProjection({
  executionDetail,
  execution,
  isolatedNodeSessionId,
  selectSessionMessages,
}) {
  const executionSessionDoc = contentOnly(executionDetail.session);
  const executionSessionId = text(execution.sessionId || executionSessionDoc.sessionId);
  const executionOwnsIsolatedSession = Boolean(
    !isolatedNodeSessionId || !executionSessionId || executionSessionId === isolatedNodeSessionId,
  );
  const sessionId = text(isolatedNodeSessionId || executionSessionId);
  if (executionOwnsIsolatedSession) {
    return {
      sessionId,
      sessionDoc: executionSessionDoc,
      messages: executionSessionDoc.messages,
    };
  }
  const isolatedSessionDoc = selectIsolatedSessionDocument(
    isolatedNodeSessionId,
    selectSessionMessages,
  );
  return {
    sessionId,
    sessionDoc: text(isolatedSessionDoc.sessionId) ? isolatedSessionDoc : { sessionId },
    messages: Array.isArray(isolatedSessionDoc.messages) ? isolatedSessionDoc.messages : [],
  };
}

function buildExecutionSessionMetadata({ sessionDoc, executionId, turnScopeId, dialogProcessId }) {
  return {
    ...projectSessionMetadata(sessionDoc),
    executionId,
    turnScopeId,
    dialogProcessId,
  };
}

function buildExecutionDetailProjection({
  runtimeNode,
  childExecutionIds,
  executionDetail,
  isolatedNodeSessionId,
  selectSessionMessages,
}) {
  const execution = contentOnly(executionDetail.execution || {});
  const { sessionId, sessionDoc, messages } = selectExecutionSessionProjection({
    executionDetail,
    execution,
    isolatedNodeSessionId,
    selectSessionMessages,
  });
  const executionId = text(execution.executionId || childExecutionIds[0]);
  const turnScopeId = text(execution.turnScopeId || runtimeNode.turnScopeId);
  const dialogProcessId = resolveDialogProcessId(runtimeNode, execution);
  return {
    executionId,
    execution,
    childExecutions: Array.isArray(executionDetail.children) ? executionDetail.children : [],
    descendantExecutions: Array.isArray(executionDetail.descendants)
      ? executionDetail.descendants
      : [],
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(messages, {
      sessionId,
      turnScopeId,
      dialogProcessId,
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
  if (!turnScopeId) return messages;
  return messages.filter((message = {}) => {
    const messageTurnScopeId = text(
      message?.turnScopeId || message?.metadata?.turnScopeId || message?.pluginMeta?.turnScopeId,
    );
    return Boolean(messageTurnScopeId) && messageTurnScopeId === turnScopeId;
  });
}

function buildIsolatedSessionProjection({
  runtimeNode,
  childExecutionIds,
  isolatedNodeSessionId,
  selectSessionMessages,
  allowEmptyMessages,
}) {
  if (!isolatedNodeSessionId) return null;
  const sessionDoc = contentOnly(selectSessionMessages(isolatedNodeSessionId));
  const messages = Array.isArray(sessionDoc.messages) ? sessionDoc.messages : [];
  const emptyProjectionAllowed = allowEmptyMessages || childExecutionIds.length > 0;
  if (!messages.length && !emptyProjectionAllowed) return null;
  const turnScopeId = text(runtimeNode.turnScopeId);
  const scopedMessages = selectScopedMessages(messages, turnScopeId);
  if (!scopedMessages.length && !emptyProjectionAllowed) return null;
  const dialogProcessId = resolveDialogProcessId(runtimeNode);
  return {
    executionId: text(childExecutionIds[0]),
    attemptExecutionIds: childExecutionIds,
    sessionId: isolatedNodeSessionId,
    messages: scopedMessages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(scopedMessages, {
      sessionId: isolatedNodeSessionId,
      turnScopeId,
      dialogProcessId,
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
  allowEmptyMessages = false,
} = {}) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const isolatedNodeSessionId = resolveIsolatedNodeSessionId(runtimeNode);
  const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
  if (childExecutionIds.length) {
    const executionDetail = selectExecutionDetail(childExecutionIds[0]);
    if (executionDetail) {
      return buildExecutionDetailProjection({
        runtimeNode,
        childExecutionIds,
        executionDetail,
        isolatedNodeSessionId,
        selectSessionMessages,
      });
    }
  }
  return buildIsolatedSessionProjection({
    runtimeNode,
    childExecutionIds,
    isolatedNodeSessionId,
    selectSessionMessages,
    allowEmptyMessages,
  });
}
