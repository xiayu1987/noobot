/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import { resolveWorkflowDialogProcessId } from "./workflowDialogProcessIdCompat.js";

function getRegistryValue(registry) {
  if (registry && typeof registry === "object" && "value" in registry) return registry.value || {};
  return registry && typeof registry === "object" ? registry : {};
}

function getListValue(value) {
  const resolved = value && typeof value === "object" && "value" in value ? value.value : value;
  return Array.isArray(resolved) ? resolved : [];
}

function text(value) {
  return String(value || "").trim();
}

function projectionItemKey(item = {}, index = 0) {
  return text(item?.id || item?.messageId || item?.turnScopeId || item?.dialogProcessId) || `index:${index}`;
}

function mergeProjectionItems(baseItems = [], incomingItems = []) {
  const merged = new Map();
  (Array.isArray(baseItems) ? baseItems : []).forEach((item, index) => {
    merged.set(projectionItemKey(item, index), item);
  });
  (Array.isArray(incomingItems) ? incomingItems : []).forEach((item, index) => {
    const key = projectionItemKey(item, index);
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  });
  return [...merged.values()];
}

/** Merge persisted full detail with the realtime projection without allowing a
 * partial realtime document to erase user messages or turn metadata. */
export function mergeUnifiedSessionDetail(base = {}, incoming = {}) {
  const baseSummary = base?.sessionSummary && typeof base.sessionSummary === "object" ? base.sessionSummary : {};
  const incomingSummary = incoming?.sessionSummary && typeof incoming.sessionSummary === "object" ? incoming.sessionSummary : {};
  const messages = mergeProjectionItems(
    Array.isArray(base?.messages) ? base.messages : baseSummary.messages,
    Array.isArray(incoming?.messages) ? incoming.messages : incomingSummary.messages,
  );
  const rawMessages = mergeProjectionItems(base?.rawMessages, incoming?.rawMessages);
  return {
    ...base,
    ...incoming,
    sessionId: text(incoming?.sessionId || base?.sessionId || incomingSummary.sessionId || baseSummary.sessionId),
    messages,
    rawMessages: rawMessages.length ? rawMessages : messages,
    sessionSummary: {
      ...baseSummary,
      ...incomingSummary,
      messages,
      turnStatuses: mergeProjectionItems(baseSummary.turnStatuses, incomingSummary.turnStatuses),
      turnTimings: mergeProjectionItems(baseSummary.turnTimings, incomingSummary.turnTimings),
    },
  };
}

function getSessionBucket(registry = {}, sessionId = "") {
  const sessions = registry?.sessions && typeof registry.sessions === "object" ? registry.sessions : {};
  return sessions[sessionId] || registry?.[sessionId] || null;
}

function selectSessionTurnRuntime(registry = {}, sessionId = "") {
  const bucket = getSessionBucket(registry, sessionId);
  if (!bucket || typeof bucket !== "object") return null;
  if (bucket.currentTurn && typeof bucket.currentTurn === "object") return bucket.currentTurn;
  const turns = bucket.turns && typeof bucket.turns === "object" ? bucket.turns : {};
  const activeKey = text(bucket.activeTurnScopeId || bucket.currentTurnScopeId);
  if (activeKey && turns[activeKey]) return turns[activeKey];
  const values = Object.values(turns);
  return values.length ? values[values.length - 1] : null;
}

function resolveTurnRuntimeByScope(registry = {}, turnScopeId = "", { sessionId = "" } = {}) {
  const scope = text(turnScopeId);
  if (!scope) return selectSessionTurnRuntime(registry, sessionId);
  const bucket = getSessionBucket(registry, sessionId);
  const direct = bucket?.turns?.[scope] || bucket?.turnRuntimes?.[scope];
  if (direct) return direct;
  const candidates = [];
  if (bucket?.currentTurn) candidates.push(bucket.currentTurn);
  if (bucket?.turns && typeof bucket.turns === "object") candidates.push(...Object.values(bucket.turns));
  if (bucket?.turnRuntimes && typeof bucket.turnRuntimes === "object") candidates.push(...Object.values(bucket.turnRuntimes));
  return candidates.find((item = {}) => text(item?.turnScopeId || item?.scopeId) === scope) || null;
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

export function buildUnifiedSessionDetail({
  nodeItem = {},
  runtimeNodeSessions = [],
  selectSessionMessages = null,
  selectExecutionDetail = null,
  turnRuntimeRegistry = null,
  allowEmptyMessages = false,
} = {}) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  const childExecutionIds = resolveNodeChildExecutionIds(nodeItem, runtimeNodeSessions);
  if (childExecutionIds.length && typeof selectExecutionDetail === "function") {
    const executionDetail = selectExecutionDetail(childExecutionIds[0]);
    if (executionDetail) {
      const execution = executionDetail.execution || {};
      const sessionDoc = executionDetail.session || {};
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
          turnRuntime: execution,
          messages,
        },
      };
    }
  }
  // Child Execution identity remains authoritative, but its projection can
  // arrive after sub-session events. Use only the node's preallocated session
  // identity as the realtime fallback; never infer another child by dialog.
  const sessionId = text(runtimeNode?.sessionId || runtimeNode?.nodeSessionId || nodeItem?.sessionId || nodeItem?.nodeSessionId);
  if (!sessionId || typeof selectSessionMessages !== "function") return null;
  const sessionDoc = selectSessionMessages(sessionId);
  if (!sessionDoc || typeof sessionDoc !== "object") return null;
  const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
  const registry = getRegistryValue(turnRuntimeRegistry);
  const turnScopeId = text(runtimeNode?.turnScopeId || nodeItem?.turnScopeId);
  const dialogProcessId = text(runtimeNode?.dialogProcessId || resolveWorkflowDialogProcessId(runtimeNode) || resolveWorkflowDialogProcessId(nodeItem));
  const runtimeTurn = turnScopeId
    ? resolveTurnRuntimeByScope(registry, turnScopeId, { sessionId })
    : selectSessionTurnRuntime(registry, sessionId);
  if (!messages.length && !runtimeTurn && !allowEmptyMessages && !childExecutionIds.length) return null;
  const scopedMessages = turnScopeId
    ? messages.filter((messageItem = {}) => {
      const messageTurnScopeId = text(messageItem?.turnScopeId || messageItem?.metadata?.turnScopeId || messageItem?.pluginMeta?.turnScopeId);
      const messageDialogProcessId = text(messageItem?.dialogProcessId || messageItem?.metadata?.dialogProcessId || messageItem?.pluginMeta?.dialogProcessId);
      if (messageTurnScopeId) return messageTurnScopeId === turnScopeId;
      if (messageDialogProcessId && dialogProcessId) return messageDialogProcessId === dialogProcessId;
      return true;
    })
    : messages;
  if (!scopedMessages.length && !runtimeTurn && !allowEmptyMessages && !childExecutionIds.length) return null;
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
      turnRuntime: runtimeTurn || null,
      messages: scopedMessages,
    },
  };
}
