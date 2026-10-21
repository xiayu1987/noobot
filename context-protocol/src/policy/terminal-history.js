/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isContextControlMessage } from "./injected-message.js";
import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  deriveContextMessageProjectionId,
  readContextMessageField,
  resolveContextInjectedMessageType,
  resolveContextMessageDialogProcessId,
  resolveContextMessageFlags,
  resolveContextMessageOrigin,
  resolveContextMessageRole,
  resolveContextMessageTurnScopeId,
  writeContextMessageMetadata,
} from "../message/codec.js";
import { CONTEXT_INTERNAL_MESSAGE_TYPE } from "../message/internal-types.js";
import { text } from "@noobot/shared/value";

const TERMINAL_HISTORY_STATUS = Object.freeze({
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  TIMEOUT: "timeout",
});

const TERMINAL_HISTORY_STATUSES = new Set(Object.values(TERMINAL_HISTORY_STATUS));

function messageTerminalIdentityKey(message = {}) {
  const turnScopeId = resolveContextMessageTurnScopeId(message);
  const dialogProcessId = resolveContextMessageDialogProcessId(message);
  if (!turnScopeId || !dialogProcessId) return "";
  return `${turnScopeId}\u0000${dialogProcessId}`;
}

function normalizeTerminalStatus(status = {}) {
  const normalizedStatus = text(status?.status).toLowerCase();
  if (!TERMINAL_HISTORY_STATUSES.has(normalizedStatus)) return null;
  const turnScopeId = text(status?.turnScopeId);
  const dialogProcessId = text(status?.dialogProcessId);
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
    parentDialogProcessId: text(status?.parentDialogProcessId),
    identityKey: `${turnScopeId}\u0000${dialogProcessId}`,
  };
}

function isOriginalUserMessage(message = {}) {
  return (
    resolveContextMessageRole(message) === "user" &&
    resolveContextMessageOrigin(message) === "natural" &&
    !resolveContextMessageFlags(message).injected
  );
}

function latestInjectedMessages(messages = []) {
  const latestByType = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    if (isContextControlMessage(message)) return;
    const type = resolveContextInjectedMessageType(message);
    if (!type) return;
    const owner = readContextMessageField(message, "injectedBy");
    latestByType.set(`${owner}:${type}`, { message, index });
  });
  return [...latestByType.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ message }) => message);
}

function projectTerminalSourceMessage(message = {}) {
  return writeContextMessageMetadata(
    { ...message, additional_kwargs: { ...message.additional_kwargs } },
    { summarized: undefined, terminalHistoryProjection: true },
  );
}

function buildTerminalExplanation(status = {}) {
  const role = status.status === TERMINAL_HISTORY_STATUS.USER_STOPPED ? "user" : "assistant";
  return writeContextMessageMetadata(
    { role, content: status.description },
    {
      messageUid: deriveContextMessageProjectionId(
        status.turnScopeId,
        CONTEXT_MESSAGE_PROJECTION_TYPE.TERMINAL_STATUS,
      ),
      dialogProcessId: status.dialogProcessId,
      parentDialogProcessId: status.parentDialogProcessId || undefined,
      turnScopeId: status.turnScopeId,
      messageOrigin: "internal",
      noobotInternalMessageType: CONTEXT_INTERNAL_MESSAGE_TYPE.TERMINAL_HISTORY_EXPLANATION,
      terminalHistoryProjection: true,
      terminalHistoryExplanation: true,
      terminalStatus: status.status,
      terminalReason: status.reason || undefined,
    },
  );
}

export function projectTerminalHistoryMessages({ messages = [], terminalStatuses = [] } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const statusByIdentity = new Map();
  for (const statusValue of Array.isArray(terminalStatuses) ? terminalStatuses : []) {
    const status = normalizeTerminalStatus(statusValue);
    if (!status) continue;
    statusByIdentity.set(status.identityKey, status);
  }
  if (!statusByIdentity.size) return source;

  const messagesByIdentity = new Map();
  for (const message of source) {
    const identity = messageTerminalIdentityKey(message);
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
  const emittedTerminalIdentities = new Set();
  const projected = [];
  for (const message of source) {
    const identity = messageTerminalIdentityKey(message);
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
        `terminal history round is missing its canonical natural user message: ${status.turnScopeId}`,
      );
    }
    projected.push(projectTerminalSourceMessage(originalUser));
    projected.push(...latestInjectedMessages(scoped).map(projectTerminalSourceMessage));
    projected.push(buildTerminalExplanation(status));
  }
  return projected;
}
