/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  isInjectedMessage,
  readMessageField,
  resolveInjectedMessageType,
  resolveMessageDialogProcessId,
  resolveMessageRole,
} from "./message.js";

export const TERMINAL_HISTORY_STATUS = Object.freeze({
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  TIMEOUT: "timeout",
});

const TERMINAL_HISTORY_STATUSES = new Set(Object.values(TERMINAL_HISTORY_STATUS));

function text(value) {
  return String(value || "").trim();
}

function resolveTurnScopeId(value = {}) {
  return readMessageField(value, "turnScopeId");
}

function terminalIdentityKey(value = {}) {
  const turnScopeId = resolveTurnScopeId(value);
  const dialogProcessId = resolveMessageDialogProcessId(value);
  if (!turnScopeId || !dialogProcessId) return "";
  return `${turnScopeId}\u0000${dialogProcessId}`;
}

function normalizeTerminalStatus(status = {}) {
  const normalizedStatus = text(status?.status).toLowerCase();
  if (!TERMINAL_HISTORY_STATUSES.has(normalizedStatus)) return null;
  const turnScopeId = resolveTurnScopeId(status);
  const dialogProcessId = resolveMessageDialogProcessId(status);
  if (!turnScopeId || !dialogProcessId) {
    throw new Error("terminal history status requires dialogProcessId and turnScopeId");
  }
  const description = text(status?.description);
  if (!description) {
    throw new Error("terminal history status requires an explanation description");
  }
  return {
    status: normalizedStatus,
    reason: text(status?.reason),
    description,
    turnScopeId,
    dialogProcessId,
    parentDialogProcessId: readMessageField(status, "parentDialogProcessId"),
  };
}

function isOriginalUserMessage(message = {}) {
  return (
    resolveMessageRole(message) === "user" &&
    message?.frontendUserMessage === true &&
    !isInjectedMessage(message)
  );
}

function latestInjectedMessages(messages = []) {
  const latestByType = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    if (!isInjectedMessage(message)) return;
    const type = resolveInjectedMessageType(message);
    if (!type) return;
    const owner = readMessageField(message, "injectedBy") || "injected";
    latestByType.set(`${owner}:${type}`, { message, index });
  });
  return [...latestByType.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ message }) => message);
}

function projectTerminalSourceMessage(message = {}) {
  return {
    ...message,
    summarized: false,
    terminalHistoryProjection: true,
  };
}

function buildTerminalExplanation(status = {}) {
  const role = status.status === TERMINAL_HISTORY_STATUS.USER_STOPPED ? "user" : "assistant";
  const noobotMessageId = `${status.turnScopeId}::terminal_status`;
  return {
    messageUid: noobotMessageId,
    role,
    type: "message",
    content: status.description,
    dialogProcessId: status.dialogProcessId,
    parentDialogProcessId: status.parentDialogProcessId,
    turnScopeId: status.turnScopeId,
    summarized: false,
    terminalHistoryProjection: true,
    terminalHistoryExplanation: true,
    terminalStatus: status.status,
    terminalReason: status.reason,
    messageOrigin: "internal",
    additional_kwargs: {
      noobotMessageId,
      noobotInternalMessageType: "terminal_history_explanation",
      terminalStatus: status.status,
      terminalReason: status.reason,
    },
  };
}

export function projectTerminalHistoryMessages({ messages = [], terminalStatuses = [] } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const statusByIdentity = new Map();
  for (const statusValue of Array.isArray(terminalStatuses) ? terminalStatuses : []) {
    const status = normalizeTerminalStatus(statusValue);
    if (!status) continue;
    statusByIdentity.set(terminalIdentityKey(status), status);
  }
  if (!statusByIdentity.size) return source;

  const messagesByIdentity = new Map();
  for (const message of source) {
    const identity = terminalIdentityKey(message);
    if (!identity || !statusByIdentity.has(identity)) continue;
    const scoped = messagesByIdentity.get(identity) || [];
    scoped.push(message);
    messagesByIdentity.set(identity, scoped);
  }
  for (const identity of [...statusByIdentity.keys()]) {
    if (!messagesByIdentity.has(identity)) {
      throw new Error(
        `terminal lifecycle is missing canonical messages: ${statusByIdentity.get(identity)?.turnScopeId || ""}`,
      );
    }
  }
  if (!statusByIdentity.size) return source;

  const emittedTerminalIdentities = new Set();
  const projected = [];
  for (const message of source) {
    const identity = terminalIdentityKey(message);
    const status = identity ? statusByIdentity.get(identity) : null;
    if (!status) {
      projected.push(message);
      continue;
    }
    if (emittedTerminalIdentities.has(identity)) continue;
    emittedTerminalIdentities.add(identity);
    const scoped = messagesByIdentity.get(identity) || [];
    const originalUser = scoped.find(isOriginalUserMessage);
    if (!originalUser) {
      throw new Error(
        `terminal history round is missing its canonical frontend user message: ${status.turnScopeId}`,
      );
    }
    projected.push(projectTerminalSourceMessage(originalUser));
    projected.push(...latestInjectedMessages(scoped).map(projectTerminalSourceMessage));
    projected.push(buildTerminalExplanation(status));
  }
  return projected;
}
