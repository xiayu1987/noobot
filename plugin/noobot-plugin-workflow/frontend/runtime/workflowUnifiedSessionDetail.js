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

function resolveProjectionState(...values) {
  const states = values.map((value) => text(value).toLowerCase()).filter(Boolean);
  return states.find((state) => TERMINAL_EXECUTION_STATES.has(state)) || states[0] || "";
}

function statusStepStateFromProjection(state = "") {
  const normalized = text(state).toLowerCase();
  if (["completed", "succeeded"].includes(normalized)) return "completed";
  if (["failed", "error", "expired", "timeout", "no_conversation"].includes(normalized)) return "error";
  if (["cancelled", "aborted", "user_stopped"].includes(normalized)) return "stopped";
  if (["requesting", "pending", "queued"].includes(normalized)) return "requesting";
  if (["sending", "starting"].includes(normalized)) return "sending";
  if (normalized) return "completing";
  return "";
}

export function projectTurnStatusOntoAssistant(messages = [], {
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  state = "",
} = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const normalizedSessionId = text(sessionId);
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  const projectedStatusStepState = statusStepStateFromProjection(state);
  if (!projectedStatusStepState) return source;

  return source.map((item = {}) => {
    if (text(item?.role).toLowerCase() !== "assistant") return item;
    const itemSessionId = text(item?.sessionId || item?.metadata?.sessionId);
    const itemScopeId = text(item?.turnScopeId || item?.metadata?.turnScopeId);
    const itemDialogId = text(item?.dialogProcessId || item?.metadata?.dialogProcessId);
    if (normalizedSessionId && itemSessionId && itemSessionId !== normalizedSessionId) return item;
    if (scopeId && itemScopeId) {
      if (itemScopeId !== scopeId) return item;
    } else if (scopeId || itemScopeId) {
      return item;
    } else if (normalizedDialogProcessId && itemDialogId && itemDialogId !== normalizedDialogProcessId) {
      return item;
    }
    return {
      ...item,
      sessionId: itemSessionId || normalizedSessionId,
      statusTurnScopeId: scopeId || itemScopeId,
      projectedStatusStepState,
    };
  });
}

export function withRunningAssistantPlaceholder(messages = [], {
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  state = "",
} = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const normalizedState = text(state).toLowerCase();
  const scopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  if (!normalizedState || TERMINAL_EXECUTION_STATES.has(normalizedState)) return source;
  const matchesTurn = (item = {}) => {
    const itemScopeId = text(item?.turnScopeId || item?.metadata?.turnScopeId);
    const itemDialogId = text(item?.dialogProcessId || item?.metadata?.dialogProcessId);
    if (scopeId && itemScopeId) return itemScopeId === scopeId;
    if (normalizedDialogProcessId && itemDialogId) return itemDialogId === normalizedDialogProcessId;
    return !scopeId && !normalizedDialogProcessId;
  };
  const matchingUser = source.find((item = {}) => text(item?.role).toLowerCase() === "user" && matchesTurn(item));
  if (!matchingUser) return source;
  if (source.some((item = {}) => text(item?.role).toLowerCase() === "assistant" && matchesTurn(item))) return source;
  return [...source, {
    id: `workflow-node-running:${scopeId || normalizedDialogProcessId || text(sessionId)}`,
    role: "assistant",
    type: "message",
    content: "",
    pending: true,
    synthetic: true,
    placeholder: true,
    turnPlaceholder: true,
    workflowNodeRunningPlaceholder: true,
    sessionId: text(matchingUser?.sessionId || matchingUser?.metadata?.sessionId || sessionId),
    turnScopeId: scopeId,
    dialogProcessId: text(
      matchingUser?.dialogProcessId || matchingUser?.metadata?.dialogProcessId || normalizedDialogProcessId,
    ),
  }];
}

function withoutSupersededRunningPlaceholders(messages = [], { terminal = false } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const realAssistantKeys = new Set(source
    .filter((item = {}) => text(item?.role).toLowerCase() === "assistant" && item?.workflowNodeRunningPlaceholder !== true)
    .flatMap((item = {}) => [
      text(item?.turnScopeId || item?.metadata?.turnScopeId),
      text(item?.dialogProcessId || item?.metadata?.dialogProcessId),
    ].filter(Boolean)));
  return source.filter((item = {}) => {
    if (item?.workflowNodeRunningPlaceholder !== true) return true;
    const identityKeys = [text(item?.turnScopeId), text(item?.dialogProcessId)].filter(Boolean);
    return !identityKeys.some((key) => realAssistantKeys.has(key));
  });
}

export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const merged = mergeCanonicalSessionDetail(contentOnly(base), contentOnly(incoming));
  const mergedState = resolveProjectionState(
    merged?.execution?.state,
    merged?.execution?.status,
    merged?.sessionSummary?.state,
    merged?.sessionSummary?.status,
    merged?.state,
    merged?.status,
  );
  const terminal = TERMINAL_EXECUTION_STATES.has(mergedState);
  const messages = withoutSupersededRunningPlaceholders(merged.messages, { terminal });
  const rawMessages = withoutSupersededRunningPlaceholders(merged.rawMessages, { terminal });
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
  const dialogProcessId = resolveWorkflowDialogProcessId(nodeItem);
  const sessionId = text(nodeItem?.sessionId || nodeItem?.nodeSessionId);
  const nodes = getListValue(runtimeNodeSessions);
  return nodes.find((item = {}) => nodeExecutionId && text(item?.nodeExecutionId) === nodeExecutionId) ||
    nodes.find((item = {}) => dialogProcessId && resolveWorkflowDialogProcessId(item) === dialogProcessId) ||
    nodes.find((item = {}) => sessionId && text(item?.sessionId || item?.nodeSessionId) === sessionId) ||
    nodeItem ||
    {};
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
      const messages = projectTurnStatusOntoAssistant(
        withRunningAssistantPlaceholder(rawMessages, {
          sessionId,
          turnScopeId,
          dialogProcessId,
          state: projectionState,
        }),
        { sessionId, turnScopeId, dialogProcessId, state: projectionState },
      );
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
      const messageDialogProcessId = text(messageItem?.dialogProcessId || messageItem?.metadata?.dialogProcessId || messageItem?.pluginMeta?.dialogProcessId);
      if (messageTurnScopeId) return messageTurnScopeId === turnScopeId;
      if (messageDialogProcessId && dialogProcessId) return messageDialogProcessId === dialogProcessId;
      return true;
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
  const scopedMessages = projectTurnStatusOntoAssistant(
    withRunningAssistantPlaceholder(scopedRawMessages, {
      sessionId,
      turnScopeId,
      dialogProcessId,
      state: projectionState,
    }),
    { sessionId, turnScopeId, dialogProcessId, state: projectionState },
  );
  return {
    executionId: text(childExecutionIds[0]),
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages: scopedMessages,
    rawMessages: scopedRawMessages,
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
