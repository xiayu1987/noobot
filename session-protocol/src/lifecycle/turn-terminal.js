/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text as clean } from "@noobot/shared/value";
import { isSettledTurn } from "./turn-state.js";
import { positiveInteger } from "../normalize.js";

const TURN_TERMINAL_COMMAND = Object.freeze({
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  ABORTED: "aborted",
  TIMEOUT: "timeout",
});

export const TURN_TERMINAL_STATUS = Object.freeze({
  COMPLETED: "completed",
  USER_STOPPED: "user_stopped",
  ERROR: "error",
  TIMEOUT: "timeout",
});

const TURN_TERMINAL_REASON = Object.freeze({
  RUN_COMPLETED: "run_completed",
  USER_STOP: "user_stop",
  RUN_ERROR: "run_error",
  RUN_ABORTED: "run_aborted",
  RUN_TIMEOUT: "run_timeout",
});

export const TURN_UNSUCCESSFUL_TERMINAL_STATUS = Object.freeze(
  Object.values(TURN_TERMINAL_STATUS).filter((status) => status !== TURN_TERMINAL_STATUS.COMPLETED),
);

export function isUnsuccessfulTurnTerminalStatus(value = "") {
  return TURN_UNSUCCESSFUL_TERMINAL_STATUS.includes(clean(value).toLowerCase());
}

const commandContract = Object.freeze({
  [TURN_TERMINAL_COMMAND.COMPLETED]: [
    TURN_TERMINAL_STATUS.COMPLETED,
    TURN_TERMINAL_REASON.RUN_COMPLETED,
  ],
  [TURN_TERMINAL_COMMAND.USER_STOPPED]: [
    TURN_TERMINAL_STATUS.USER_STOPPED,
    TURN_TERMINAL_REASON.USER_STOP,
  ],
  [TURN_TERMINAL_COMMAND.ERROR]: [TURN_TERMINAL_STATUS.ERROR, TURN_TERMINAL_REASON.RUN_ERROR],
  [TURN_TERMINAL_COMMAND.ABORTED]: [TURN_TERMINAL_STATUS.ERROR, TURN_TERMINAL_REASON.RUN_ABORTED],
  [TURN_TERMINAL_COMMAND.TIMEOUT]: [TURN_TERMINAL_STATUS.TIMEOUT, TURN_TERMINAL_REASON.RUN_TIMEOUT],
});

function normalizeError(error = null) {
  if (!error) return null;
  if (typeof error === "string") return { message: error };
  if (typeof error !== "object" || Array.isArray(error)) return { message: String(error) };
  return Object.fromEntries(
    Object.entries({
      name: clean(error.name),
      message: clean(error.message || error.error),
      code: clean(error.code),
      stack: clean(error.stack),
    }).filter(([, value]) => value),
  );
}

function buildTurnTerminalStatus(status, reason, payload = {}) {
  const turnScopeId = clean(payload.turnScopeId);
  if (!turnScopeId) return null;
  const terminalStatus = {
    turnScopeId,
    status,
    reason,
    description: clean(payload.description),
    updatedAt: clean(payload.updatedAt),
  };
  const dialogProcessId = clean(payload.dialogProcessId);
  if (dialogProcessId) terminalStatus.dialogProcessId = dialogProcessId;
  const parentDialogProcessId = clean(payload.parentDialogProcessId);
  if (parentDialogProcessId) terminalStatus.parentDialogProcessId = parentDialogProcessId;
  const error = normalizeError(payload.error);
  if (error) terminalStatus.error = error;
  return Object.freeze(terminalStatus);
}

export function createTurnTerminalStatus(command = "", payload = {}) {
  const contract = commandContract[clean(command).toLowerCase()];
  if (!contract) return null;
  return buildTurnTerminalStatus(contract[0], contract[1], payload);
}

const contractPairs = new Set(
  Object.values(commandContract).map(([status, reason]) => `${status}\u0000${reason}`),
);

export function normalizeTurnTerminalStatus(value = null) {
  if (!isPlainObject(value)) return null;
  const status = clean(value.status);
  const reason = clean(value.reason);
  if (!contractPairs.has(`${status}\u0000${reason}`)) return null;
  return buildTurnTerminalStatus(status, reason, value);
}

export function materializeTurnTerminalMessages({
  messages = [],
  terminalStatus = null,
  assistantMessage = null,
  previousSummaryVersion = 0,
} = {}) {
  if (normalizeTurnTerminalStatus(terminalStatus) === null) {
    return Object.freeze({ materialized: false, reason: "invalid_turn_terminal_status" });
  }
  const turnScopeId = clean(terminalStatus.turnScopeId);
  const dialogProcessId = clean(terminalStatus.dialogProcessId);
  const source = Array.isArray(messages) ? messages : [];
  const scopedMessages = source.filter((message) => clean(message?.turnScopeId) === turnScopeId);
  if (
    dialogProcessId &&
    scopedMessages.some((message) => {
      const messageDialogProcessId = clean(message?.dialogProcessId);
      return messageDialogProcessId && messageDialogProcessId !== dialogProcessId;
    })
  ) {
    return Object.freeze({ materialized: false, reason: "turn_execution_identity_conflict" });
  }
  const nextMessages = source.map((message) =>
    clean(message?.turnScopeId) === turnScopeId &&
    clean(message?.role).toLowerCase() === "assistant"
      ? { ...message, pending: false }
      : message,
  );
  const hasAssistant = nextMessages.some(
    (message) =>
      clean(message?.turnScopeId) === turnScopeId &&
      clean(message?.role).toLowerCase() === "assistant",
  );
  if (!hasAssistant && isPlainObject(assistantMessage)) {
    const content = String(assistantMessage.content || "");
    const messageUid = clean(assistantMessage.messageUid);
    if (content && !messageUid) {
      return Object.freeze({
        materialized: false,
        reason: "assistant_message_identity_incomplete",
      });
    }
    if (content) {
      const assistantTurnScopeId = clean(assistantMessage.turnScopeId || turnScopeId);
      const assistantDialogProcessId = clean(assistantMessage.dialogProcessId || dialogProcessId);
      if (
        assistantTurnScopeId !== turnScopeId ||
        (dialogProcessId && assistantDialogProcessId !== dialogProcessId)
      ) {
        return Object.freeze({
          materialized: false,
          reason: "assistant_message_identity_conflict",
        });
      }
      nextMessages.push({
        ...assistantMessage,
        role: "assistant",
        pending: false,
        turnScopeId,
        ...(dialogProcessId ? { dialogProcessId } : {}),
      });
    }
  }
  return Object.freeze({
    materialized: true,
    terminalStatus,
    messages: Object.freeze(nextMessages),
    summaryVersion: positiveInteger(previousSummaryVersion) + 1,
  });
}

export function projectTurnTerminalStatuses(lifecycle) {
  return Object.values(lifecycle.turns)
    .filter(isSettledTurn)
    .map((turn) => normalizeTurnTerminalStatus(turn.terminalStatus))
    .filter(Boolean);
}
