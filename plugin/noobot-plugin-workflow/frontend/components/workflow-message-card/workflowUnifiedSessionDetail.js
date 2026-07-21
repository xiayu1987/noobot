/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";
import { mergeCanonicalSessionDetail } from "../../../../../client/noobot-chat/src/composables/infra/sessionDetailMerge.js";

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
    turnTimings: _turnTimings,
    turnStatuses: _turnStatuses,
    ...content
  } = value && typeof value === "object" ? value : {};
  return content;
}

/** Merge persisted full detail with the realtime projection without allowing a
 * partial realtime document to erase user messages or turn metadata. */
export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const merged = mergeCanonicalSessionDetail(contentOnly(base), contentOnly(incoming));
  return {
    ...contentOnly(merged),
    ...(merged.sessionSummary ? { sessionSummary: contentOnly(merged.sessionSummary) } : {}),
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
  const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
  if (childExecutionIds.length && typeof selectExecutionDetail === "function") {
    const executionDetail = selectExecutionDetail(childExecutionIds[0]);
    if (executionDetail) {
      const execution = contentOnly(executionDetail.execution || {});
      const sessionDoc = contentOnly(executionDetail.session || {});
      const messages = Array.isArray(executionDetail.messages) ? executionDetail.messages : [];
      if (!messages.length && !execution && !allowEmptyMessages) return null;
      return {
        executionId: text(execution.executionId || childExecutionIds[0]),
        execution,
        childExecutions: Array.isArray(executionDetail.children) ? executionDetail.children : [],
        descendantExecutions: Array.isArray(executionDetail.descendants) ? executionDetail.descendants : [],
        attemptExecutionIds: childExecutionIds,
        sessionId: text(execution.sessionId || sessionDoc.sessionId || sessionDoc.id),
        messages,
        rawMessages: messages,
        sessionSummary: {
          ...sessionDoc,
          sessionId: text(execution.sessionId || sessionDoc.sessionId || sessionDoc.id),
          executionId: text(execution.executionId || childExecutionIds[0]),
          turnScopeId: text(execution.turnScopeId),
          dialogProcessId: text(execution.dialogProcessId),
          messages,
        },
      };
    }
  }
  // Child Execution identity remains authoritative, but its projection can
  // arrive after sub-session events. Use only the node's preallocated session
  // identity as the realtime fallback; never infer another child by dialog.
  const sessionId = resolveIsolatedNodeSessionId(nodeItem, runtimeNode);
  if (!sessionId || typeof selectSessionMessages !== "function") return null;
  const sessionDoc = contentOnly(selectSessionMessages(sessionId));
  if (!sessionDoc || typeof sessionDoc !== "object") return null;
  const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
  const turnScopeId = text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId);
  const dialogProcessId = text(runtimeNode?.dialogProcessId || resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem));
  if (!messages.length && !allowEmptyMessages && !childExecutionIds.length) return null;
  const scopedMessages = turnScopeId
    ? messages.filter((messageItem = {}) => {
      const messageTurnScopeId = text(messageItem?.turnScopeId || messageItem?.metadata?.turnScopeId || messageItem?.pluginMeta?.turnScopeId);
      const messageDialogProcessId = text(messageItem?.dialogProcessId || messageItem?.metadata?.dialogProcessId || messageItem?.pluginMeta?.dialogProcessId);
      if (messageTurnScopeId) return messageTurnScopeId === turnScopeId;
      if (messageDialogProcessId && dialogProcessId) return messageDialogProcessId === dialogProcessId;
      return true;
    })
    : messages;
  if (!scopedMessages.length && !allowEmptyMessages && !childExecutionIds.length) return null;
  return {
    executionId: text(childExecutionIds[0]),
    attemptExecutionIds: childExecutionIds,
    sessionId,
    messages: scopedMessages,
    rawMessages: scopedMessages,
    sessionSummary: {
      ...(sessionDoc && typeof sessionDoc === "object" ? sessionDoc : {}),
      sessionId,
      parentSessionId: text(runtimeNode?.parentSessionId || sessionDoc?.parentSessionId || nodeItem?.parentSessionId),
      dialogProcessId,
      turnScopeId,
      messages: scopedMessages,
    },
  };
}
