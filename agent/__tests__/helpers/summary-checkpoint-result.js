/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";

export function summaryCheckpointResult(payload, result) {
  return {
    ...result,
    messageReceipts: payload.messages.map((message) =>
      createMessagePersistenceReceipt(
        {
          ...message,
          sessionId: payload.sessionId,
          dialogProcessId: message.dialogProcessId ?? payload.dialogProcessId,
          turnScopeId: message.turnScopeId ?? payload.turnScopeId,
        },
        result.checkpointRevision,
        `test-content-${message.messageUid}-${result.checkpointRevision}`,
        result.checkpointRevision,
      ),
    ),
  };
}
