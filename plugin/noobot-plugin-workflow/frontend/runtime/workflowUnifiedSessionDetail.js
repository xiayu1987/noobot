/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessIdCompat.js";
import { mergeCanonicalSessionDetail } from "noobot-chat/plugin-api/session-domain";

function getListValue(value) {
  const resolved = value && typeof value === "object" && "value" in value ? value.value : value;
  return Array.isArray(resolved) ? resolved : [];
}

function text(value) {
  return String(value || "").trim();
}

function contentOnly(value = {}) {
  const {
    turnRuntime: _turnRuntime,
    ...content
  } = value && typeof value === "object" ? value : {};
  return content;
}

const TERMINAL_EXECUTION_STATES = new Set([
  "completed", "succeeded", "failed", "error", "cancelled", "aborted",
  "user_stopped", "expired", "timeout", "no_conversation",
]);

export function isTerminalExecutionProjection(execution = {}) {
  if (!execution || typeof execution !== "object") return false;
  if (execution.terminal === true || execution?.lifecycle?.terminal === true) return true;
  return [
    execution.state,
    execution.status,
    execution.executionState,
    execution?.lifecycle?.state,
    execution?.lifecycle?.status,
    execution?.lifecycle?.executionState,
  ].some((state) => TERMINAL_EXECUTION_STATES.has(text(state).toLowerCase()));
}

function resolveProjectionState(...values) {
  const states = values.map((value) => text(value).toLowerCase()).filter(Boolean);
  return states.find((state) => TERMINAL_EXECUTION_STATES.has(state)) || states[0] || "";
}

export function createRunningAssistantPlaceholderViewModel(messages = [], {
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  state = "",
} = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const normalizedState = text(state).toLowerCase();
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  if (!normalizedState || TERMINAL_EXECUTION_STATES.has(normalizedState)) return null;
  const matchesTurn = (item = {}) => {
    const itemScopeId = text(item?.turnScopeId || item?.metadata?.turnScopeId);
    const itemDialogId = text(item?.dialogProcessId || item?.metadata?.dialogProcessId);
    if (scopeId && itemScopeId) return itemScopeId === scopeId;
    if (normalizedDialogProcessId && itemDialogId) return itemDialogId === normalizedDialogProcessId;
    return !scopeId && !normalizedDialogProcessId;
  };
  const matchingUser = source.find((item = {}) => text(item?.role).toLowerCase() === "user" && matchesTurn(item));
  if (!matchingUser) return null;
  if (source.some((item = {}) => text(item?.role).toLowerCase() === "assistant" && matchesTurn(item))) return null;
  return {
    viewKey: `workflow-node-running:${scopeId || normalizedDialogProcessId || text(sessionId)}`,
    sessionId: text(matchingUser?.sessionId || matchingUser?.metadata?.sessionId || sessionId),
    turnScopeId: scopeId,
    dialogProcessId: text(
      matchingUser?.dialogProcessId || matchingUser?.metadata?.dialogProcessId || normalizedDialogProcessId,
    ),
  };
}

export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const merged = mergeCanonicalSessionDetail(contentOnly(base), contentOnly(incoming));
  const messages = Array.isArray(merged.messages) ? merged.messages : [];
  const rawMessages = mergeCanonicalSessionDetail(
    { sessionId: text(base.sessionId), messages: Array.isArray(base.rawMessages) ? base.rawMessages : [] },
    { sessionId: text(incoming.sessionId), messages: Array.isArray(incoming.rawMessages) ? incoming.rawMessages : [] },
  ).messages;
  return {
    ...contentOnly(merged),
    messages,
    rawMessages,
    ...(merged.sessionSummary ? {
      sessionSummary: { ...contentOnly(merged.sessionSummary), messages },
    } : {}),
    ...(merged.execution ? { execution: contentOnly(merged.execution) } : {}),
  };
}

export function hasNewProtocolNodeIdentity(nodeItem = {}) {
  return Boolean(text(nodeItem?.activeChildExecutionId || nodeItem?.childExecutionId || nodeItem?.nodeExecutionId));
}

export function resolveNodeChildExecutionIds(nodeItem = {}, runtimeNodeSessions = []) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const current = text(runtimeNode?.activeChildExecutionId || runtimeNode?.childExecutionId || nodeItem?.activeChildExecutionId || nodeItem?.childExecutionId);
  const attempts = [
    ...(Array.isArray(runtimeNode?.attemptExecutionIds) ? runtimeNode.attemptExecutionIds : []),
    ...(Array.isArray(nodeItem?.attemptExecutionIds) ? nodeItem.attemptExecutionIds : []),
  ].map(text).filter(Boolean);
  return Array.from(new Set([current, ...attempts].filter(Boolean)));
}

export function resolveRuntimeNodeSession(nodeItem = {}, runtimeNodeSessions = []) {
  const nodeExecutionId = text(nodeItem?.nodeExecutionId);
  const nodes = getListValue(runtimeNodeSessions);
  if (!nodeExecutionId) return nodeItem || {};
  return nodes.find((item = {}) => text(item?.nodeExecutionId) === nodeExecutionId) || nodeItem || {};
}

export function resolveIsolatedNodeSessionId(nodeItem = {}, runtimeNode = {}) {
  const parentIds = new Set([
    text(nodeItem?.rootSessionId),
    text(nodeItem?.parentSessionId),
    text(runtimeNode?.rootSessionId),
    text(runtimeNode?.parentSessionId),
  ].filter(Boolean));
  const candidates = [
    runtimeNode?.nodeSessionId,
    runtimeNode?.sessionId,
    nodeItem?.nodeSessionId,
    nodeItem?.sessionId,
  ].map(text).filter(Boolean);
  return candidates.find((candidate) => !parentIds.has(candidate)) || "";
}

export function buildUnifiedSessionDetail({
  nodeItem = {},
  runtimeNodeSessions = [],
  selectSessionMessages = null,
  selectExecutionDetail = null,
  allowEmptyMessages = false,
} = {}) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const isolatedNodeSessionId = resolveIsolatedNodeSessionId(nodeItem, runtimeNode);
  const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
  if (childExecutionIds.length && typeof selectExecutionDetail === "function") {
    const executionDetail = selectExecutionDetail(childExecutionIds[0]);
    if (executionDetail) {
      const execution = contentOnly(executionDetail.execution || {});
      const executionSessionDoc = contentOnly(executionDetail.session || {});
      const executionSessionId = text(execution.sessionId || executionSessionDoc.sessionId || executionSessionDoc.id);
      const isolatedSessionDoc = isolatedNodeSessionId && typeof selectSessionMessages === "function"
        ? contentOnly(selectSessionMessages(isolatedNodeSessionId) || {})
        : {};
      const hasIsolatedSessionProjection = Boolean(
        isolatedNodeSessionId && text(isolatedSessionDoc.sessionId || isolatedSessionDoc.id),
      );
      const executionOwnsIsolatedSession = Boolean(
        !isolatedNodeSessionId || !executionSessionId || executionSessionId === isolatedNodeSessionId,
      );
      const sessionId = text(isolatedNodeSessionId || executionSessionId);
      const sessionDoc = hasIsolatedSessionProjection
        ? isolatedSessionDoc
        : executionOwnsIsolatedSession
          ? executionSessionDoc
          : { sessionId };
      const rawMessages = hasIsolatedSessionProjection
        ? (Array.isArray(isolatedSessionDoc.messages) ? isolatedSessionDoc.messages : [])
        : executionOwnsIsolatedSession && Array.isArray(executionDetail.messages)
          ? executionDetail.messages
          : [];
      const turnScopeId = text(execution.turnScopeId || runtimeNode?.turnScopeId || nodeItem?.turnScopeId);
      const dialogProcessId = text(
        execution.dialogProcessId || runtimeNode?.dialogProcessId || resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem),
      );
      const projectionState = resolveProjectionState(
        execution.state,
        execution.status,
        runtimeNode?.status,
        runtimeNode?.state,
        sessionDoc?.status,
        sessionDoc?.state,
        nodeItem?.status,
        nodeItem?.state,
      );
      const runningPlaceholderViewModel = createRunningAssistantPlaceholderViewModel(rawMessages, {
          sessionId,
          turnScopeId,
          dialogProcessId,
          state: projectionState,
        });
      const messages = rawMessages;
      if (!messages.length && !execution && !allowEmptyMessages) return null;
      return {
        executionId: text(execution.executionId || childExecutionIds[0]),
        execution,
        childExecutions: Array.isArray(executionDetail.children) ? executionDetail.children : [],
        descendantExecutions: Array.isArray(executionDetail.descendants) ? executionDetail.descendants : [],
        attemptExecutionIds: childExecutionIds,
        sessionId,
        messages,
        rawMessages,
        runningPlaceholderViewModel,
        sessionSummary: {
          ...sessionDoc,
          sessionId,
          executionId: text(execution.executionId || childExecutionIds[0]),
          turnScopeId,
          dialogProcessId,
          status: projectionState || text(sessionDoc?.status || sessionDoc?.state),
          turnStatuses: Array.isArray(sessionDoc.turnStatuses)
            ? sessionDoc.turnStatuses
            : Array.isArray(execution.turnStatuses) ? execution.turnStatuses : [],
          turnTimings: Array.isArray(sessionDoc.turnTimings)
            ? sessionDoc.turnTimings
            : Array.isArray(execution.turnTimings) ? execution.turnTimings : [],
          messages,
        },
      };
    }
  }
  const sessionId = isolatedNodeSessionId;
  if (!sessionId || typeof selectSessionMessages !== "function") return null;
  const sessionDoc = contentOnly(selectSessionMessages(sessionId));
  if (!sessionDoc || typeof sessionDoc !== "object") return null;
  const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
  const turnScopeId = text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId);
  const dialogProcessId = text(runtimeNode?.dialogProcessId || resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem));
  if (!messages.length && !allowEmptyMessages && !childExecutionIds.length) return null;
  const scopedRawMessages = turnScopeId
    ? messages.filter((messageItem = {}) => {
      const messageTurnScopeId = text(messageItem?.turnScopeId || messageItem?.metadata?.turnScopeId || messageItem?.pluginMeta?.turnScopeId);
      return Boolean(messageTurnScopeId) && messageTurnScopeId === turnScopeId;
    })
    : messages;
  if (!scopedRawMessages.length && !allowEmptyMessages && !childExecutionIds.length) return null;
  const projectionState = resolveProjectionState(
    runtimeNode?.status,
    runtimeNode?.state,
    sessionDoc?.status,
    sessionDoc?.state,
    nodeItem?.status,
    nodeItem?.state,
  );
  const runningPlaceholderViewModel = createRunningAssistantPlaceholderViewModel(scopedRawMessages, {
      sessionId,
      turnScopeId,
      dialogProcessId,
      state: projectionState,
    });
  const scopedMessages = scopedRawMessages;
  return {
    executionId: text(childExecutionIds[0]),
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages: scopedMessages,
    rawMessages: scopedRawMessages,
    runningPlaceholderViewModel,
    sessionSummary: {
      ...(sessionDoc && typeof sessionDoc === "object" ? sessionDoc : {}),
      sessionId,
      parentSessionId: text(runtimeNode?.parentSessionId || sessionDoc?.parentSessionId || nodeItem?.parentSessionId),
      dialogProcessId,
      status: projectionState || text(sessionDoc?.status || sessionDoc?.state),
      turnScopeId,
      messages: scopedMessages,
    },
  };
}
