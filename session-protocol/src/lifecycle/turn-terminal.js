/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSettledTurn, TURN_STATE } from "./turn-state.js";

export const TURN_TERMINAL_COMMAND = Object.freeze({
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

export const TURN_TERMINAL_REASON = Object.freeze({
  RUN_COMPLETED: "run_completed",
  USER_STOP: "user_stop",
  RUN_ERROR: "run_error",
  RUN_ABORTED: "run_aborted",
  RUN_TIMEOUT: "run_timeout",
});

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

const clean = (value) => String(value || "").trim();
const positiveInteger = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;

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

export function createTurnTerminalStatus(command = "", payload = {}) {
  const contract = commandContract[clean(command).toLowerCase()];
  if (!contract) return null;
  const turnScopeId = clean(payload.turnScopeId);
  const dialogProcessId = clean(payload.dialogProcessId);
  if (!turnScopeId) return null;
  const status = {
    turnScopeId,
    status: contract[0],
    reason: contract[1],
    description: clean(payload.description),
    updatedAt: clean(payload.updatedAt),
  };
  if (dialogProcessId) status.dialogProcessId = dialogProcessId;
  const parentDialogProcessId = clean(payload.parentDialogProcessId);
  if (parentDialogProcessId) status.parentDialogProcessId = parentDialogProcessId;
  const error = normalizeError(payload.error);
  if (error) status.error = error;
  return Object.freeze(status);
}

/**
 * Materializes the presentation side of one terminal fact. This is a pure
 * aggregate decision: lifecycle remains the terminal authority while messages
 * are its persisted presentation entities.
 */
export function materializeTurnTerminalMessages({
  messages = [],
  terminalStatus = null,
  assistantMessage = null,
  previousSummaryVersion = 0,
} = {}) {
  if (!terminalStatus || typeof terminalStatus !== "object" || Array.isArray(terminalStatus)) {
    return Object.freeze({ materialized: false, reason: "invalid_turn_terminal_status" });
  }
  const turnScopeId = clean(terminalStatus.turnScopeId);
  const dialogProcessId = clean(terminalStatus.dialogProcessId);
  if (!turnScopeId) {
    return Object.freeze({ materialized: false, reason: "turn_identity_incomplete" });
  }
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
  if (
    !hasAssistant &&
    assistantMessage &&
    typeof assistantMessage === "object" &&
    !Array.isArray(assistantMessage)
  ) {
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

export function deriveTerminalStatusFromTurn(turn = {}) {
  if (!isSettledTurn(turn)) return null;
  if (turn.terminalStatus && typeof turn.terminalStatus === "object") return turn.terminalStatus;
  const command =
    turn.state === TURN_STATE.COMPLETED
      ? TURN_TERMINAL_COMMAND.COMPLETED
      : turn.state === TURN_STATE.STOP_COMPLETED
        ? TURN_TERMINAL_COMMAND.USER_STOPPED
        : TURN_TERMINAL_COMMAND.ERROR;
  return createTurnTerminalStatus(command, {
    ...turn,
    error: turn.failure,
    updatedAt: turn.updatedAt,
  });
}

export function projectTurnTerminalStatuses(lifecycle = {}) {
  return Object.values(lifecycle?.turns || {})
    .map(deriveTerminalStatusFromTurn)
    .filter(Boolean);
}
