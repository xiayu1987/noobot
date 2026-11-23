/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createMessagePersistenceReceipt,
  mergeMessagePersistenceDeltas,
} from "@noobot/session-protocol/session-changes";

export function createTestMessageCreationBatch({ messages, ...payload }) {
  return { ...payload, messages, changes: mergeMessagePersistenceDeltas([{ messages }]) };
}

export function createTestMessagePersistenceReceipts(
  { messages, sessionId, dialogProcessId, turnScopeId },
  generation = 1,
) {
  return messages.map((message) =>
    createMessagePersistenceReceipt(
      {
        ...message,
        sessionId,
        dialogProcessId: message.dialogProcessId || dialogProcessId,
        turnScopeId: message.turnScopeId || turnScopeId,
      },
      generation,
      `test-content-${message.messageUid}-${generation}`,
      1,
    ),
  );
}
