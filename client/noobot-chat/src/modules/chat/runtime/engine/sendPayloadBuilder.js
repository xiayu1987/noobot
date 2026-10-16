/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildChatPayload } from "./payload.js";

export function createTurnPayloadBuilder({ preferences, request, turn }) {
  const { continueFromUserStopped } = request;
  return ({ expectedAggregateVersion } = {}) =>
    buildChatPayload({
      ...preferences,
      activeSession: turn.activeSession,
      message: turn.text,
      expectedAggregateVersion,
      attachments: turn.attachments,
      requestedTextStreaming: turn.requestedTextStreaming,
      dialogProcessId: request.dialogProcessId,
      turnScopeId: request.turnScopeId,
      userMessageId: request.userMessageId,
      assistantMessageId: request.assistantMessageId,
      continueFromStopped: continueFromUserStopped,
      resumeDialogProcessId: continueFromUserStopped ? request.resumeDialogProcessId : "",
      resumeTurnScopeId: continueFromUserStopped ? request.resumeTurnScopeId : "",
      uploadHint: turn.uploadHint,
      reuseExistingUserTurn: request.reuseExistingUserTurn,
    });
}
