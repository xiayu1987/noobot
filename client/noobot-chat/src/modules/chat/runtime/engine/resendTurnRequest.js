/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils.js";
import {
  logResendDebug,
  summarizeDebugAttachments,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";

export function createReplaceTurnRequester({ activeSession, authFetch, replaceSessionTurnApi, userId }) {
  return async function requestReplaceTurn({
    sessionId,
    originalSession,
    anchor,
    text,
    resendTurnScopeId,
    commandId,
    attempt,
    expectedAggregateVersion,
    attachments,
  }) {
    logResendDebug("resend.replaceTurn.request", () => ({
      sessionId,
      turnScopeId: resendTurnScopeId,
      anchor,
      expectedAggregateVersion,
      attempt,
      commandId,
      attachments: summarizeDebugAttachments(attachments),
      messages: summarizeDebugMessages(activeSession?.value?.messages),
    }));
    const result = await replaceSessionTurnApi(
      {
        userId: userId?.value || userId,
        sessionId,
        parentSessionId: normalizeTrimmedString(originalSession?.parentSessionId),
        anchor,
        newContent: text,
        turnScopeId: resendTurnScopeId,
        expectedAggregateVersion,
        commandId,
        attachments,
      },
      { fetcher: authFetch },
    );
    const payload = typeof result?.json === "function" ? await result.json() : result;
    return { result, payload };
  };
}
