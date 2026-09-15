/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildChatPayload } from "./payload.js";
import { normalizeTrimmedString } from "./utils.js";

/**
 * Builds the per-attempt chat payload factory. The returned function is called
 * once per aggregate-version attempt, so only the expected version varies.
 */
export function createTurnPayloadBuilder({ preferences, request, turn }) {
  const { continueFromUserStopped } = request;
  return ({ expectedAggregateVersion } = {}) =>
    buildChatPayload({
      ...preferences,
      activeSession: turn.activeSession,
      message: turn.text,
      commandId: request.turnScopeId,
      expectedAggregateVersion: expectedAggregateVersion ?? 0,
      attachments: turn.attachments,
      requestedTextStreaming: turn.requestedTextStreaming,
      dialogProcessId: request.dialogProcessId,
      turnScopeId: request.turnScopeId,
      userMessageId: normalizeTrimmedString(
        turn.userMessage?.messageId || turn.userMessage?.id || request.userMessageId,
      ),
      assistantMessageId: request.assistantMessageId,
      continueFromStopped: continueFromUserStopped,
      resumeDialogProcessId: continueFromUserStopped ? request.resumeDialogProcessId : "",
      resumeTurnScopeId: continueFromUserStopped ? request.resumeTurnScopeId : "",
      uploadHint: turn.uploadHint,
      reuseExistingUserTurn: request.reuseExistingUserTurn,
    });
}
