/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";

export const TURN_COMMAND_TYPE = Object.freeze({ SEND: "send", CONTINUE: "continue" });
export const TURN_COMMAND_ORIGIN = Object.freeze({ USER: "user", INTERNAL: "internal" });

const trim = (value = "") => String(value || "").trim();

export function resolveRunTurnScopeId({ caller = "user", turnScopeId = "" } = {}) {
  const requested = trim(turnScopeId);
  if (requested) return requested;
  if (trim(caller).toLowerCase() === "bot") return `internal-turn:${randomUUID()}`;
  return `server-turn:${randomUUID()}`;
}

export function createTurnCommand({ userId = "", sessionId = "", parentSessionId = "",
  dialogProcessId = "", parentDialogProcessId = "", turnScopeId = "", message = "",
  attachments = [], runConfig = {}, caller = "user" } = {}) {
  const resume = runConfig?.resumeFromStoppedSnapshot === true;
  const origin = trim(caller).toLowerCase() === "bot"
    ? TURN_COMMAND_ORIGIN.INTERNAL
    : TURN_COMMAND_ORIGIN.USER;
  const command = {
    type: resume ? TURN_COMMAND_TYPE.CONTINUE : TURN_COMMAND_TYPE.SEND,
    origin,
    userId: trim(userId), sessionId: trim(sessionId), parentSessionId: trim(parentSessionId),
    dialogProcessId: trim(dialogProcessId), parentDialogProcessId: trim(parentDialogProcessId),
    turnScopeId: trim(turnScopeId), message: String(message || "").trim(),
    messageId: trim(runConfig?.userMessageId),
    attachments: Array.isArray(attachments) ? attachments : [],
    expectedAggregateVersion: runConfig?.expectedAggregateVersion,
    commandId: trim(runConfig?.commandId || turnScopeId),
    sourceIdentity: resume ? {
      dialogProcessId: trim(runConfig?.resumeDialogProcessId),
      turnScopeId: trim(runConfig?.resumeTurnScopeId),
    } : null,
  };
  if (!command.userId || !command.sessionId || !command.turnScopeId || !command.commandId) {
    const error = new Error("turn command identity is incomplete");
    error.statusCode = 400; error.errorCode = "INVALID_TURN_COMMAND"; throw error;
  }
  if (resume && (!command.sourceIdentity.dialogProcessId || !command.sourceIdentity.turnScopeId)) {
    const error = new Error("continue command source identity is incomplete");
    error.statusCode = 400; error.errorCode = "INVALID_CONTINUE_SOURCE_IDENTITY"; throw error;
  }
  if (resume && origin !== TURN_COMMAND_ORIGIN.USER) {
    const error = new Error("only user turns can continue a stopped turn");
    error.statusCode = 400; error.errorCode = "INVALID_CONTINUE_ORIGIN"; throw error;
  }
  return Object.freeze(command);
}

export function toCommitTurnPayload(command = {}) {
  return {
    userId: command.userId, sessionId: command.sessionId, parentSessionId: command.parentSessionId,
    content: command.message, attachments: command.attachments,
    messageId: command.messageId,
    dialogProcessId: command.dialogProcessId, parentDialogProcessId: command.parentDialogProcessId,
    turnScopeId: command.turnScopeId, action: command.type,
    frontendUserMessage: command.origin === TURN_COMMAND_ORIGIN.USER,
    commandId: command.commandId, expectedAggregateVersion: command.expectedAggregateVersion,
    resumeDialogProcessId: command.sourceIdentity?.dialogProcessId,
    resumeTurnScopeId: command.sourceIdentity?.turnScopeId,
  };
}
