/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  normalizeTurnScopeIdKey,
} from "../../model/messageIdentity.js";
import { isTurnRuntimeDeleted } from "../run-state-machine/turnRuntimeRegistry.js";

function text(value = "") {
  return String(value || "").trim();
}

function sessionIdFromSession(session = {}) {
  return text(session?.backendSessionId || session?.sessionId || session?.id);
}

function effectiveMessageSessionId(message = {}, fallbackSessionId = "") {
  return text(fallbackSessionId) || getMessageSessionId(message);
}

function sessionIdentitySet(session = {}) {
  return new Set([
    session?.backendSessionId,
    session?.sessionId,
    session?.id,
  ].map(text).filter(Boolean));
}

function turnKey(sessionId = "", turnScopeId = "") {
  const normalizedSessionId = text(sessionId);
  const normalizedTurnScopeId = normalizeTurnScopeIdKey(turnScopeId);
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
}

function messageTurnKey(message = {}, fallbackSessionId = "") {
  return turnKey(
    effectiveMessageSessionId(message, fallbackSessionId),
    getMessageTurnScopeId(message),
  );
}

function workflowPayload(message = {}) {
  return message?.pluginMeta?.payload && typeof message.pluginMeta.payload === "object"
    ? message.pluginMeta.payload
    : {};
}

export function isWorkflowPresentationMessage(message = {}) {
  const payload = workflowPayload(message);
  return Boolean(
    text(message?.type).toLowerCase() === "workflow" ||
    message?.workflowMessage === true ||
    (
      text(message?.pluginMeta?.source).toLowerCase() === "workflow-plugin" &&
      text(message?.pluginMeta?.kind).toLowerCase() === "workflow"
    ) ||
    text(payload?.workflowRunId),
  );
}

function workflowRunIdFromMessage(message = {}) {
  const payload = workflowPayload(message);
  return text(
    payload?.workflowRunId ||
    payload?.execution?.workflowRunId ||
    payload?.execution?.instanceId ||
    message?.workflowRunId,
  );
}

function isEmptyAssistantPlaceholder(message = {}) {
  return getMessageRole(message) === "assistant" &&
    !isWorkflowPresentationMessage(message) &&
    !text(message?.content);
}

function isTurnStatusPresentation(message = {}) {
  return getMessageRole(message) === "assistant" &&
    message?.turnStatusPlaceholder === true;
}

const TERMINAL_PRESENTATION_STATES = new Set(["user_stopped", "error", "timeout"]);

function normalizeTerminalStatus(status = {}) {
  const state = text(status?.status).toLowerCase();
  return TERMINAL_PRESENTATION_STATES.has(state) ? { ...status, status: state } : null;
}

function terminalStatusKey(status = {}, fallbackSessionId = "") {
  return turnKey(
    text(fallbackSessionId || status?.sessionId),
    status?.turnScopeId,
  );
}

function terminalErrorText(status = {}) {
  return text(
    typeof status?.error === "string"
      ? status.error
      : status?.error?.message || status?.error?.reason,
  );
}

function formatTerminalStatusContent(status = {}) {
  const state = text(status?.status).toLowerCase();
  const title = state === "user_stopped"
    ? "本轮已由用户停止"
    : state === "timeout"
      ? "本轮已超时停止"
      : "本轮异常停止";
  const description = text(status?.description);
  const reason = text(status?.reason);
  const error = terminalErrorText(status);
  return [
    title,
    description,
    reason && `原因：${reason}`,
    error && `异常：${error}`,
  ].filter(Boolean).join("\n");
}

function buildTerminalPresentation(status = {}, fallbackSessionId = "") {
  const turnScopeId = text(status?.turnScopeId);
  const dialogProcessId = text(status?.dialogProcessId);
  const timestamp = text(status?.updatedAt || status?.createdAt);
  return {
    id: `turn-status-placeholder:${turnScopeId || dialogProcessId}`,
    messageId: `turn-status-placeholder:${turnScopeId || dialogProcessId}`,
    sessionId: text(fallbackSessionId || status?.sessionId),
    role: "assistant",
    content: formatTerminalStatusContent(status),
    pending: false,
    synthetic: true,
    placeholder: true,
    turnPlaceholder: true,
    turnStatusPlaceholder: true,
    turnStatus: { ...status },
    status: status?.status,
    state: status?.status,
    statusReason: status?.reason,
    statusDescription: status?.description,
    error: terminalErrorText(status),
    turnScopeId,
    dialogProcessId,
    ts: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function buildLiveWorkflowPresentationMessage(workflow = {}, fallbackSessionId = "") {
  const workflowRunId = text(workflow?.workflowRunId);
  const sessionId = text(workflow?.sessionId || fallbackSessionId);
  const turnScopeId = text(workflow?.turnScopeId);
  if (!workflowRunId || !sessionId || !turnScopeId) return null;
  return {
    id: `workflow-live:${workflowRunId}`,
    sessionId,
    role: "assistant",
    type: "workflow",
    pluginMessage: true,
    dialogProcessId: text(workflow?.dialogProcessId),
    turnScopeId,
    content: text(workflow?.semanticText),
    __workflowLiveProjection: true,
    pluginMeta: {
      source: "workflow-plugin",
      kind: "workflow",
      phase: "planning",
      payload: {
        workflowRunId,
        nodeSessions: Object.values(workflow?.nodes || {}),
        planningDialog: {
          sessionId,
          dialogProcessId: text(workflow?.dialogProcessId),
        },
        execution: {
          instanceId: workflowRunId,
          workflowRunId,
          started: false,
        },
      },
    },
  };
}

function mergeWorkflowIntoShell(shell = {}, workflowMessage = {}) {
  return {
    ...shell,
    ...workflowMessage,
    id: shell?.id || workflowMessage?.id,
    ts: shell?.ts || workflowMessage?.ts,
    sessionId: getMessageSessionId(shell) || getMessageSessionId(workflowMessage),
    turnScopeId: getMessageTurnScopeId(shell) || getMessageTurnScopeId(workflowMessage),
    dialogProcessId: shell?.dialogProcessId || workflowMessage?.dialogProcessId || "",
    __turnPresentationShellId: text(shell?.id || workflowMessage?.id),
  };
}

function mergeTurnStatusIntoAssistant(shell = {}, terminalPresentation = {}) {
  const shellContent = text(shell?.content);
  const terminalContent = text(terminalPresentation?.content);
  const content = shellContent && terminalContent && shellContent !== terminalContent
    ? `${shellContent}\n\n${terminalContent}`
    : shellContent || terminalContent;
  return {
    ...shell,
    ...terminalPresentation,
    id: shell?.id || shell?.messageId || terminalPresentation?.id,
    messageId: shell?.messageId || shell?.id || terminalPresentation?.messageId || terminalPresentation?.id,
    sessionId: getMessageSessionId(shell) || getMessageSessionId(terminalPresentation),
    turnScopeId: getMessageTurnScopeId(shell) || getMessageTurnScopeId(terminalPresentation),
    dialogProcessId: shell?.dialogProcessId || terminalPresentation?.dialogProcessId || "",
    content,
    toolTimeline: shell?.toolTimeline || terminalPresentation?.toolTimeline || [],
    activityTimeline: shell?.activityTimeline || terminalPresentation?.activityTimeline || [],
    attachments: shell?.attachments || terminalPresentation?.attachments || [],
    ts: shell?.ts || terminalPresentation?.ts,
    __turnStatusPresentation: true,
    __turnStatusPlaceholderId: text(terminalPresentation?.id),
  };
}

function coalescePersistedAssistantPresentations(messages = [], activeSessionId = "") {
  const output = [];
  const assistantIndexByTurn = new Map();
  for (const message of messages) {
    const key = messageTurnKey(message, activeSessionId);
    if (getMessageRole(message) !== "assistant" || !key) {
      output.push(message);
      continue;
    }
    const existingIndex = assistantIndexByTurn.get(key);
    if (existingIndex === undefined) {
      assistantIndexByTurn.set(key, output.length);
      output.push(message);
      continue;
    }
    const existing = output[existingIndex];
    const existingTurnStatus = isTurnStatusPresentation(existing);
    const incomingTurnStatus = isTurnStatusPresentation(message);
    if (existingTurnStatus !== incomingTurnStatus) {
      output[existingIndex] = existingTurnStatus
        ? mergeTurnStatusIntoAssistant(message, existing)
        : mergeTurnStatusIntoAssistant(existing, message);
      continue;
    }
    const existingWorkflow = isWorkflowPresentationMessage(existing);
    const incomingWorkflow = isWorkflowPresentationMessage(message);
    if (incomingWorkflow && (existingWorkflow || isEmptyAssistantPlaceholder(existing))) {
      output[existingIndex] = mergeWorkflowIntoShell(existing, message);
      continue;
    }
    if (existingWorkflow && isEmptyAssistantPlaceholder(message)) continue;
    output.push(message);
  }
  return output;
}

export function selectTurnPresentations({
  activeSession = {},
  workflowRegistry = {},
  turnRuntimeRegistry = {},
} = {}) {
  const activeSessionId = sessionIdFromSession(activeSession);
  const activeSessionIds = sessionIdentitySet(activeSession);
  const sourceMessages = Array.isArray(activeSession?.messages) ? activeSession.messages : [];
  const terminalByTurn = new Map(
    (Array.isArray(activeSession?.turnStatuses) ? activeSession.turnStatuses : [])
      .map(normalizeTerminalStatus)
      .filter(Boolean)
      .map((status) => [terminalStatusKey(status, activeSessionId), status])
      .filter(([key]) => Boolean(key)),
  );
  const projectedTerminalTurns = new Set();
  const messagesWithTerminalPresentation = sourceMessages.map((message) => {
    if (getMessageRole(message) !== "assistant") return message;
    const key = messageTurnKey(message, activeSessionId);
    const status = terminalByTurn.get(key);
    if (!status) return message;
    projectedTerminalTurns.add(key);
    return mergeTurnStatusIntoAssistant(
      message,
      buildTerminalPresentation(status, activeSessionId),
    );
  });
  for (const [key, status] of terminalByTurn.entries()) {
    if (projectedTerminalTurns.has(key)) continue;
    const presentation = buildTerminalPresentation(status, activeSessionId);
    const userIndex = messagesWithTerminalPresentation.findLastIndex((message) =>
      getMessageRole(message) === "user" && messageTurnKey(message, activeSessionId) === key,
    );
    messagesWithTerminalPresentation.splice(
      userIndex >= 0 ? userIndex + 1 : messagesWithTerminalPresentation.length,
      0,
      presentation,
    );
  }
  const messages = coalescePersistedAssistantPresentations(
    messagesWithTerminalPresentation,
    activeSessionId,
  );
  const persistedRunIds = new Set(messages.map(workflowRunIdFromMessage).filter(Boolean));
  const persistedTurnKeys = new Set(
    messages
      .filter(isWorkflowPresentationMessage)
      .map((message) => messageTurnKey(message, activeSessionId))
      .filter(Boolean),
  );
  const liveByTurn = new Map();

  for (const workflow of Object.values(workflowRegistry?.workflows || {})) {
    const projection = buildLiveWorkflowPresentationMessage(workflow, activeSessionId);
    if (!projection) continue;
    const key = messageTurnKey(projection, activeSessionId);
    if (!key || !activeSessionIds.has(getMessageSessionId(projection))) continue;
    if (isTurnRuntimeDeleted(turnRuntimeRegistry, {
      sessionId: getMessageSessionId(projection) || activeSessionId,
      turnScopeId: getMessageTurnScopeId(projection),
    })) continue;
    if (persistedRunIds.has(workflowRunIdFromMessage(projection)) || persistedTurnKeys.has(key)) continue;
    liveByTurn.set(key, projection);
  }

  const projectedTurns = new Set();
  const presentations = messages.map((message) => {
    const key = messageTurnKey(message, activeSessionId);
    const liveWorkflow = getMessageRole(message) === "assistant" ? liveByTurn.get(key) : null;
    if (!liveWorkflow) return message;
    projectedTurns.add(key);
    return mergeWorkflowIntoShell(message, liveWorkflow);
  });

  for (const [key, liveWorkflow] of liveByTurn.entries()) {
    if (projectedTurns.has(key)) continue;
    const userIndex = presentations.findLastIndex((message) =>
      getMessageRole(message) === "user" && messageTurnKey(message, activeSessionId) === key,
    );
    presentations.splice(userIndex >= 0 ? userIndex + 1 : presentations.length, 0, liveWorkflow);
  }

  return presentations;
}
