/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveWorkflowDialogProcessId } from "../utils/workflowDialogProcessId.js";
import { mergeCanonicalSessionDetail } from "noobot-chat/plugin-api/session-domain";

function getListValue(value) {
  const resolved = value && typeof value === "object" && "value" in value ? value.value : value;
  return Array.isArray(resolved) ? resolved : [];
}

function text(value) {
  return String(value || "").trim();
}

function contentOnly(value = {}) {
  const { turnRuntime: _turnRuntime, ...content } = value && typeof value === "object" ? value : {};
  return content;
}

const TERMINAL_EXECUTION_STATES = new Set([
  "completed",
  "succeeded",
  "failed",
  "error",
  "cancelled",
  "aborted",
  "user_stopped",
  "expired",
  "timeout",
  "no_conversation",
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
  messages = [],
  { sessionId = "", turnScopeId = "", dialogProcessId = "", state = "" } = {},
) {
  const source = Array.isArray(messages) ? messages : [];
  const normalizedState = text(state).toLowerCase();
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  if (!normalizedState || TERMINAL_EXECUTION_STATES.has(normalizedState)) return null;
  const matchesTurn = createTurnMessageMatcher(scopeId, normalizedDialogProcessId);
  const matchingUser = findTurnRoleMessage(source, "user", matchesTurn);
  if (!matchingUser) return null;
  if (findTurnRoleMessage(source, "assistant", matchesTurn)) return null;
  return buildRunningPlaceholderIdentity(matchingUser, {
    sessionId,
    scopeId,
    dialogProcessId: normalizedDialogProcessId,
  });
}

export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const merged = mergeCanonicalSessionDetail(contentOnly(base), contentOnly(incoming));
  const messages = Array.isArray(merged.messages) ? merged.messages : [];
  const rawMessages = mergeCanonicalSessionDetail(
    {
      sessionId: text(base.sessionId),
      messages: Array.isArray(base.rawMessages) ? base.rawMessages : [],
    },
    {
      sessionId: text(incoming.sessionId),
      messages: Array.isArray(incoming.rawMessages) ? incoming.rawMessages : [],
    },
  ).messages;
  return {
    ...contentOnly(merged),
    messages,
    rawMessages,
    ...(merged.sessionSummary
      ? {
          sessionSummary: { ...contentOnly(merged.sessionSummary), messages },
        }
      : {}),
    ...(merged.execution ? { execution: contentOnly(merged.execution) } : {}),
  };
}

export function hasNewProtocolNodeIdentity(nodeItem = {}) {
  return Boolean(
    text(
      nodeItem?.activeChildExecutionId || nodeItem?.childExecutionId || nodeItem?.nodeExecutionId,
    ),
  );
}

export function resolveNodeChildExecutionIds(nodeItem = {}, runtimeNodeSessions = []) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const current = text(
    runtimeNode?.activeChildExecutionId ||
      runtimeNode?.childExecutionId ||
      nodeItem?.activeChildExecutionId ||
      nodeItem?.childExecutionId,
  );
  const attempts = [
    ...(Array.isArray(runtimeNode?.attemptExecutionIds) ? runtimeNode.attemptExecutionIds : []),
    ...(Array.isArray(nodeItem?.attemptExecutionIds) ? nodeItem.attemptExecutionIds : []),
  ]
    .map(text)
    .filter(Boolean);
  return Array.from(new Set([current, ...attempts].filter(Boolean)));
}

export function resolveRuntimeNodeSession(nodeItem = {}, runtimeNodeSessions = []) {
  const nodeExecutionId = text(nodeItem?.nodeExecutionId);
  const nodes = getListValue(runtimeNodeSessions);
  if (!nodeExecutionId) return nodeItem || {};
  return (
    nodes.find((item = {}) => text(item?.nodeExecutionId) === nodeExecutionId) || nodeItem || {}
  );
}

export function resolveIsolatedNodeSessionId(nodeItem = {}, runtimeNode = {}) {
  const parentIds = new Set(
    [
      text(nodeItem?.rootSessionId),
      text(nodeItem?.parentSessionId),
      text(runtimeNode?.rootSessionId),
      text(runtimeNode?.parentSessionId),
    ].filter(Boolean),
  );
  const candidates = [
    runtimeNode?.nodeSessionId,
    runtimeNode?.sessionId,
    nodeItem?.nodeSessionId,
    nodeItem?.sessionId,
  ]
    .map(text)
    .filter(Boolean);
  return candidates.find((candidate) => !parentIds.has(candidate)) || "";
}

function resolveDialogProcessId(nodeItem, runtimeNode, execution = {}) {
  return text(
    execution.dialogProcessId ||
      runtimeNode?.dialogProcessId ||
      resolveWorkflowDialogProcessId(runtimeNode) ||
      resolveWorkflowDialogProcessId(nodeItem),
  );
}

function selectIsolatedSessionDocument(isolatedNodeSessionId, selectSessionMessages) {
  if (!isolatedNodeSessionId || typeof selectSessionMessages !== "function") return {};
  return contentOnly(selectSessionMessages(isolatedNodeSessionId) || {});
}

function selectExecutionSessionProjection({
  executionDetail,
  execution,
  isolatedNodeSessionId,
  selectSessionMessages,
}) {
  const executionSessionDoc = contentOnly(executionDetail.session || {});
  const executionSessionId = text(
    execution.sessionId || executionSessionDoc.sessionId || executionSessionDoc.id,
  );
  const isolatedSessionDoc = selectIsolatedSessionDocument(
    isolatedNodeSessionId,
    selectSessionMessages,
  );
  const hasIsolatedSessionProjection = Boolean(
    isolatedNodeSessionId && text(isolatedSessionDoc.sessionId || isolatedSessionDoc.id),
  );
  const executionOwnsIsolatedSession = Boolean(
    !isolatedNodeSessionId || !executionSessionId || executionSessionId === isolatedNodeSessionId,
  );
  const sessionId = text(isolatedNodeSessionId || executionSessionId);
  if (hasIsolatedSessionProjection) {
    return {
      sessionId,
      sessionDoc: isolatedSessionDoc,
      rawMessages: Array.isArray(isolatedSessionDoc.messages) ? isolatedSessionDoc.messages : [],
    };
  }
  return {
    sessionId,
    sessionDoc: executionOwnsIsolatedSession ? executionSessionDoc : { sessionId },
    rawMessages:
      executionOwnsIsolatedSession && Array.isArray(executionDetail.messages)
        ? executionDetail.messages
        : [],
  };
}

function buildExecutionSessionSummary({
  sessionDoc,
  messages,
  sessionId,
  execution,
  executionId,
  turnScopeId,
  dialogProcessId,
  projectionState,
}) {
  return {
    ...sessionDoc,
    sessionId,
    executionId,
    turnScopeId,
    dialogProcessId,
    status: projectionState || text(sessionDoc?.status || sessionDoc?.state),
    turnTimings: Array.isArray(sessionDoc.turnTimings)
      ? sessionDoc.turnTimings
      : Array.isArray(execution.turnTimings)
        ? execution.turnTimings
        : [],
    messages,
  };
}

function buildExecutionDetailProjection({
  nodeItem,
  runtimeNode,
  childExecutionIds,
  executionDetail,
  isolatedNodeSessionId,
  selectSessionMessages,
}) {
  const execution = contentOnly(executionDetail.execution || {});
  const { sessionId, sessionDoc, rawMessages } = selectExecutionSessionProjection({
    executionDetail,
    execution,
    isolatedNodeSessionId,
    selectSessionMessages,
  });
  const executionId = text(execution.executionId || childExecutionIds[0]);
  const turnScopeId = text(
    execution.turnScopeId || runtimeNode?.turnScopeId || nodeItem?.turnScopeId,
  );
  const dialogProcessId = resolveDialogProcessId(nodeItem, runtimeNode, execution);
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
  return {
    executionId,
    execution,
    childExecutions: Array.isArray(executionDetail.children) ? executionDetail.children : [],
    descendantExecutions: Array.isArray(executionDetail.descendants)
      ? executionDetail.descendants
      : [],
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages: rawMessages,
    rawMessages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(rawMessages, {
      sessionId,
      turnScopeId,
      dialogProcessId,
      state: projectionState,
    }),
    sessionSummary: buildExecutionSessionSummary({
      sessionDoc,
      messages: rawMessages,
      sessionId,
      execution,
      executionId,
      turnScopeId,
      dialogProcessId,
      projectionState,
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

function isolatedProjectionState(nodeItem, runtimeNode, sessionDoc) {
  return resolveProjectionState(
    runtimeNode?.status,
    runtimeNode?.state,
    sessionDoc?.status,
    sessionDoc?.state,
    nodeItem?.status,
    nodeItem?.state,
  );
}

function buildIsolatedSessionSummary({
  nodeItem,
  runtimeNode,
  sessionDoc,
  sessionId,
  dialogProcessId,
  projectionState,
  turnScopeId,
  messages,
}) {
  return {
    ...sessionDoc,
    sessionId,
    parentSessionId: text(
      runtimeNode?.parentSessionId || sessionDoc?.parentSessionId || nodeItem?.parentSessionId,
    ),
    dialogProcessId,
    status: projectionState || text(sessionDoc?.status || sessionDoc?.state),
    turnScopeId,
    messages,
  };
}

function buildIsolatedSessionProjection({
  nodeItem,
  runtimeNode,
  childExecutionIds,
  isolatedNodeSessionId,
  selectSessionMessages,
  allowEmptyMessages,
}) {
  if (!isolatedNodeSessionId || typeof selectSessionMessages !== "function") return null;
  const sessionDoc = contentOnly(selectSessionMessages(isolatedNodeSessionId));
  const messages = Array.isArray(sessionDoc.messages) ? sessionDoc.messages : [];
  const emptyProjectionAllowed = allowEmptyMessages || childExecutionIds.length > 0;
  if (!messages.length && !emptyProjectionAllowed) return null;
  const turnScopeId = text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId);
  const scopedMessages = selectScopedMessages(messages, turnScopeId);
  if (!scopedMessages.length && !emptyProjectionAllowed) return null;
  const dialogProcessId = resolveDialogProcessId(nodeItem, runtimeNode);
  const projectionState = isolatedProjectionState(nodeItem, runtimeNode, sessionDoc);
  return {
    executionId: text(childExecutionIds[0]),
    attemptExecutionIds: childExecutionIds,
    sessionId: isolatedNodeSessionId,
    messages: scopedMessages,
    rawMessages: scopedMessages,
    runningPlaceholderViewModel: createRunningAssistantPlaceholderViewModel(scopedMessages, {
      sessionId: isolatedNodeSessionId,
      turnScopeId,
      dialogProcessId,
      state: projectionState,
    }),
    sessionSummary: buildIsolatedSessionSummary({
      nodeItem,
      runtimeNode,
      sessionDoc,
      sessionId: isolatedNodeSessionId,
      dialogProcessId,
      projectionState,
      turnScopeId,
      messages: scopedMessages,
    }),
  };
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
      return buildExecutionDetailProjection({
        nodeItem,
        runtimeNode,
        childExecutionIds,
        executionDetail,
        isolatedNodeSessionId,
        selectSessionMessages,
      });
    }
  }
  return buildIsolatedSessionProjection({
    nodeItem,
    runtimeNode,
    childExecutionIds,
    isolatedNodeSessionId,
    selectSessionMessages,
    allowEmptyMessages,
  });
}
