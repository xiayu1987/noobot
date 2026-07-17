/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";

const normalize = (value = "") => String(value || "").trim();

export function isTurnPlaceholderMessage(message = {}) {
  return getMessageRole(message) === RoleEnum.ASSISTANT && message?.turnPlaceholder === true;
}

export function initializeTurnPlaceholder(message, {
  sessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
  pending = true,
  synthetic = false,
} = {}) {
  if (!message || typeof message !== "object") return null;
  const normalizedSessionId = normalize(sessionId);
  const normalizedTurnScopeId = normalize(turnScopeId);
  const normalizedDialogProcessId = normalize(dialogProcessId);
  Object.assign(message, {
    role: RoleEnum.ASSISTANT,
    turnPlaceholder: true,
    placeholder: true,
    synthetic: synthetic === true,
    pending: pending === true,
    statusLabel: "",
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    realtimeLogs: Array.isArray(message.realtimeLogs) ? message.realtimeLogs : [],
    completedToolLogs: Array.isArray(message.completedToolLogs) ? message.completedToolLogs : [],
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    executionLogTotal: Number(message.executionLogTotal || 0),
    hasFirstStreamEvent: message.hasFirstStreamEvent === true,
  });
  if (normalizedSessionId) {
    message.sessionId = normalizedSessionId;
    message.session_id = normalizedSessionId;
  }
  if (normalizedTurnScopeId) message.turnScopeId = normalizedTurnScopeId;
  if (normalizedDialogProcessId) message.dialogProcessId = normalizedDialogProcessId;
  return message;
}

export function createTurnPlaceholderMessage({ appendMessage, ...identity } = {}) {
  if (typeof appendMessage !== "function") return null;
  return initializeTurnPlaceholder(appendMessage(RoleEnum.ASSISTANT, "", []), identity);
}

export function findTurnPlaceholderMessage(messages = [], { turnScopeId = "", dialogProcessId = "" } = {}) {
  const scope = normalize(turnScopeId);
  const dialog = normalize(dialogProcessId);
  return [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => (
    isTurnPlaceholderMessage(message) &&
    ((scope && getMessageTurnScopeId(message) === scope) ||
      (dialog && getMessageDialogProcessId(message) === dialog))
  )) || null;
}

export function removeTurnPlaceholderMessages(messages = [], identity = {}) {
  const scope = normalize(identity.turnScopeId);
  const dialog = normalize(identity.dialogProcessId);
  if (!scope && !dialog) return Array.isArray(messages) ? messages : [];
  return (Array.isArray(messages) ? messages : []).filter((message) => !(
    isTurnPlaceholderMessage(message) &&
    ((scope && getMessageTurnScopeId(message) === scope) ||
      (dialog && getMessageDialogProcessId(message) === dialog))
  ));
}
