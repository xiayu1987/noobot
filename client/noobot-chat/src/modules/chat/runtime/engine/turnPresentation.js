/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRole, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { isTurnRuntimeDeleted } from "../run-state-machine/turnRuntimeRegistry.js";
import {
  isTurnTerminalNotice,
  resolveTurnTerminalNoticeLabelKey,
  TURN_RUNTIME_TERMINAL,
} from "../sessionRunStateMachine.js";
import { translateStoredLocaleMessageKey } from "../../../../shared/i18n/messageCatalog.js";
import { logThinkingReplayDebug } from "../../../debug/loggers/thinkingReplayDebugLogger.js";
import { mergeTransferEnvelopes } from "@noobot/semantic-transfer-protocol";
import { getMessageTransferEnvelopes } from "../../model/transferEnvelopes.js";
import { isPlainObject, text } from "@noobot/shared/value";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";

function sessionIdFromSession(session = {}) {
  return text(session?.sessionId);
}

function turnKey(sessionId = "", turnScopeId = "") {
  const normalizedSessionId = text(sessionId);
  const normalizedTurnScopeId = text(turnScopeId);
  return normalizedSessionId && normalizedTurnScopeId
    ? `${normalizedSessionId}::${normalizedTurnScopeId}`
    : "";
}

function messageTurnKey(message, containerSessionId) {
  return turnKey(containerSessionId, getMessageTurnScopeId(message));
}

function workflowPayload(message = {}) {
  return message?.pluginMeta?.payload && typeof message.pluginMeta.payload === "object"
    ? message.pluginMeta.payload
    : {};
}

function isWorkflowPresentationMessage(message = {}) {
  const payload = workflowPayload(message);
  return Boolean(
    text(message?.type).toLowerCase() === "workflow" ||
    message?.workflowMessage === true ||
    (text(message?.pluginMeta?.source).toLowerCase() === "workflow-plugin" &&
      text(message?.pluginMeta?.kind).toLowerCase() === "workflow") ||
    text(payload?.workflowRunId),
  );
}

function isEmptyAssistantPlaceholder(message = {}) {
  return (
    getMessageRole(message) === "assistant" &&
    !isWorkflowPresentationMessage(message) &&
    !text(message?.content)
  );
}

function normalizeTerminalStatus(status = {}) {
  const state = text(status?.status).toLowerCase();
  return isTurnTerminalNotice(state) ? { ...status, status: state } : null;
}

function terminalStatusKey(status = {}, sessionId = "") {
  return turnKey(sessionId, status?.turnScopeId);
}

function terminalStatusesFromRuntime(turnRuntimeRegistry, sessionId) {
  const bucket = turnRuntimeRegistry.sessions[sessionId];
  return Object.values(bucket ? bucket.turns : {})
    .filter((turn = {}) => isTurnTerminalNotice(turn?.terminal))
    .map((turn = {}) => ({
      sessionId,
      turnScopeId: text(turn?.turnScopeId),
      dialogProcessId: text(turn?.dialogProcessId),
      status: text(turn?.terminal).toLowerCase(),
      failureMessage: text(turn?.failure?.message),
      updatedAt: text(turn?.finishedAt || turn?.updatedAt),
    }))
    .filter((status) => Boolean(status.turnScopeId));
}

function authoritativeTurnSequence(turnRuntimeRegistry, sessionId, turnScopeId) {
  const normalizedSessionId = text(sessionId);
  const normalizedTurnScopeId = text(turnScopeId);
  const turn = turnRuntimeRegistry.sessions[normalizedSessionId]?.turns[normalizedTurnScopeId];
  return Number(turn?.lifecycleSeq || 0);
}

function formatTerminalStatusContent(status = {}) {
  const state = text(status?.status).toLowerCase();
  const label = translateStoredLocaleMessageKey(resolveTurnTerminalNoticeLabelKey(state));
  const failureMessage = state === TURN_RUNTIME_TERMINAL.ERROR ? text(status?.failureMessage) : "";
  return failureMessage
    ? `${label}\n${translateStoredLocaleMessageKey("message.turnTerminalErrorDetail", { error: failureMessage })}`
    : label;
}

function buildTerminalPresentation(status = {}, sessionId = "") {
  const turnScopeId = text(status?.turnScopeId);
  const dialogProcessId = text(status?.dialogProcessId);
  const timestamp = text(status?.updatedAt);
  return {
    presentationMessageId: `turn-status-placeholder:${turnScopeId}`,
    sessionId: text(sessionId),
    role: "assistant",
    type: "message",
    content: formatTerminalStatusContent(status),
    pending: false,
    synthetic: true,
    placeholder: true,
    turnPlaceholder: true,
    turnStatusPlaceholder: true,
    turnStatus: { ...status },
    turnScopeId,
    dialogProcessId,
    ts: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildLiveWorkflowPresentationMessage(workflow) {
  const workflowRunId = text(workflow?.workflowRunId);
  const sessionId = workflow.sessionId;
  const turnScopeId = text(workflow?.turnScopeId);
  const presentationMessageId = text(workflow?.presentationMessageId);
  const workflowPayload = isPlainObject(workflow?.workflowPayload)
    ? workflow.workflowPayload
    : null;
  if (!workflowRunId || !sessionId || !turnScopeId || !presentationMessageId || !workflowPayload)
    return null;
  return {
    presentationMessageId,
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
      payload: workflowPayload,
    },
  };
}

function mergeWorkflowIntoShell(shell = {}, workflowMessage = {}) {
  if (isWorkflowPresentationMessage(shell)) return shell;
  const canonicalContent = text(shell?.content);
  const livePlanningContent = text(workflowMessage?.content);
  const content = canonicalContent || livePlanningContent;
  const merged = {
    ...shell,
    ...workflowMessage,
    presentationMessageId: resolveMessageViewKey(shell) || resolveMessageViewKey(workflowMessage),
    ts: shell?.ts || workflowMessage?.ts,
    turnScopeId: getMessageTurnScopeId(shell) || getMessageTurnScopeId(workflowMessage),
    dialogProcessId: shell?.dialogProcessId || workflowMessage?.dialogProcessId || "",
    content,
  };
  logThinkingReplayDebug("frontend.turnPresentation.workflowMerged", () => ({
    sessionId: merged.sessionId,
    dialogProcessId: text(merged?.dialogProcessId),
    turnScopeId: getMessageTurnScopeId(merged),
    shellPresentationMessageId: resolveMessageViewKey(shell),
    livePresentationMessageId: resolveMessageViewKey(workflowMessage),
    canonicalContentLength: canonicalContent.length,
    livePlanningContentLength: livePlanningContent.length,
    selectedContentSource: canonicalContent ? "canonical" : "live_planning",
    selectedContentLength: content.length,
    canonicalType: text(shell?.type),
    canonicalPhase: text(shell?.pluginMeta?.phase),
    livePhase: text(workflowMessage?.pluginMeta?.phase),
  }));
  return merged;
}

function mergeTurnStatusIntoAssistant(shell = {}, terminalPresentation = {}) {
  const shellContent = text(shell?.content);
  const terminalContent = text(terminalPresentation?.content);
  const content =
    shellContent && terminalContent && shellContent !== terminalContent
      ? `${shellContent}\n\n${terminalContent}`
      : shellContent || terminalContent;
  return {
    ...shell,
    ...terminalPresentation,
    presentationMessageId:
      resolveMessageViewKey(shell) || resolveMessageViewKey(terminalPresentation),
    turnScopeId: getMessageTurnScopeId(shell) || getMessageTurnScopeId(terminalPresentation),
    dialogProcessId: shell?.dialogProcessId || terminalPresentation?.dialogProcessId || "",
    content,
    toolTimeline: shell?.toolTimeline || [],
    activityTimeline: shell?.activityTimeline || [],
    attachments: shell?.attachments || [],
    ts: shell?.ts || terminalPresentation?.ts,
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
    const existingWorkflow = isWorkflowPresentationMessage(existing);
    const incomingWorkflow = isWorkflowPresentationMessage(message);
    if (incomingWorkflow && (existingWorkflow || isEmptyAssistantPlaceholder(existing))) {
      output[existingIndex] = mergeWorkflowIntoShell(existing, message);
      continue;
    }
    if (existingWorkflow && isEmptyAssistantPlaceholder(message)) continue;
    throw new Error(`[turn-presentation] multiple canonical assistant presentations for ${key}`);
  }
  return output;
}

export function selectTurnPresentations({
  activeSession = {},
  workflowRegistry,
  turnRuntimeRegistry,
}) {
  const activeSessionId = sessionIdFromSession(activeSession);
  const sourceMessages = (
    Array.isArray(activeSession?.messages) ? activeSession.messages : []
  ).filter(
    (message) =>
      !isTurnRuntimeDeleted(turnRuntimeRegistry, {
        sessionId: activeSessionId,
        turnScopeId: getMessageTurnScopeId(message),
      }),
  );

  const envelopesByTurn = new Map();
  for (const message of sourceMessages) {
    const key = messageTurnKey(message, activeSessionId);
    if (!key) continue;
    const envelopes = getMessageTransferEnvelopes(message);
    if (!envelopes.length) continue;
    envelopesByTurn.set(key, mergeTransferEnvelopes(envelopesByTurn.get(key) || [], envelopes));
  }
  const projectedSourceMessages = sourceMessages.map((message) => {
    if (getMessageRole(message) !== "assistant") return message;
    const messageKey = messageTurnKey(message, activeSessionId);
    const turnEnvelopes = envelopesByTurn.get(messageKey) || [];
    if (!turnEnvelopes.length) return message;
    const ownEnvelopes = getMessageTransferEnvelopes(message);
    const mergedEnvelopes = mergeTransferEnvelopes(ownEnvelopes, turnEnvelopes);
    if (mergedEnvelopes.length === ownEnvelopes.length) return message;
    return {
      ...message,
      transferEnvelopes: mergedEnvelopes,
    };
  });
  const terminalStatuses = terminalStatusesFromRuntime(turnRuntimeRegistry, activeSessionId).filter(
    (status) =>
      !isTurnRuntimeDeleted(turnRuntimeRegistry, {
        sessionId: activeSessionId,
        turnScopeId: status?.turnScopeId,
      }),
  );
  const terminalByTurn = new Map(
    terminalStatuses
      .map(normalizeTerminalStatus)
      .filter(Boolean)
      .map((status) => [terminalStatusKey(status, activeSessionId), status])
      .filter(([key]) => Boolean(key)),
  );
  const projectedTerminalTurns = new Set();
  const messagesWithTerminalPresentation = projectedSourceMessages.map((message) => {
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
    const userIndex = messagesWithTerminalPresentation.findLastIndex(
      (message) =>
        getMessageRole(message) === "user" && messageTurnKey(message, activeSessionId) === key,
    );
    const statusSequence = authoritativeTurnSequence(
      turnRuntimeRegistry,
      activeSessionId,
      status?.turnScopeId,
    );
    const nextTurnIndex =
      statusSequence > 0
        ? messagesWithTerminalPresentation.findIndex((message) => {
            const messageSequence = authoritativeTurnSequence(
              turnRuntimeRegistry,
              activeSessionId,
              getMessageTurnScopeId(message),
            );
            return messageSequence > statusSequence;
          })
        : -1;
    messagesWithTerminalPresentation.splice(
      userIndex >= 0
        ? userIndex + 1
        : nextTurnIndex >= 0
          ? nextTurnIndex
          : messagesWithTerminalPresentation.length,
      0,
      presentation,
    );
  }
  const messages = coalescePersistedAssistantPresentations(
    messagesWithTerminalPresentation,
    activeSessionId,
  );
  const liveByTurn = new Map();

  for (const workflow of Object.values(workflowRegistry.workflows)) {
    if (workflow.sessionId !== activeSessionId) continue;
    const projection = buildLiveWorkflowPresentationMessage(workflow);
    if (!projection) continue;
    const key = messageTurnKey(projection, activeSessionId);
    if (!key) continue;
    if (
      isTurnRuntimeDeleted(turnRuntimeRegistry, {
        sessionId: activeSessionId,
        turnScopeId: getMessageTurnScopeId(projection),
      })
    )
      continue;
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
    const userIndex = presentations.findLastIndex(
      (message) =>
        getMessageRole(message) === "user" && messageTurnKey(message, activeSessionId) === key,
    );
    presentations.splice(userIndex >= 0 ? userIndex + 1 : presentations.length, 0, liveWorkflow);
  }

  return presentations;
}
