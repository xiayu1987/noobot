/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { buildTurnEntity } from "./turn-upsert.js";
import {
  createSessionChangesSubmission,
  requireSessionChanges,
} from "@noobot/session-protocol/session-changes";

export async function appendTurns({
  userId,
  sessionId,
  turns,
  messageDiagnostics = [],
  messageContentAppends = [],
  messageMetadataUpdates = [],
  persistenceContext,
  submission = createSessionChangesSubmission(),
} = {}) {
  requireSessionChanges({
    messages: turns.map((turn) => ({ ...turn, sessionId })),
    messageContentAppends,
    messageMetadataUpdates,
    messageDiagnostics,
  });
  if (!turns.length && !messageContentAppends.length && !messageMetadataUpdates.length) {
    throw new TypeError("appendTurns requires non-empty message changes");
  }
  return this.sessionRepo.withSessionCommit(
    userId,
    sessionId,
    async ({ prepareRequest, scope, commitChanges }) => {
      const committed = await submission.submit({
        userId,
        sessionId,
        prepare: () =>
          prepareRequest({
            operationId: randomUUID(),
            changes: {
              messages: turns.map((turn) =>
                buildTurnEntity(this, scope.resolvedParentSessionId, {
                  ...turn,
                  userId,
                  sessionId,
                }),
              ),
              messageContentAppends,
              messageMetadataUpdates,
              ...(messageDiagnostics.length ? { messageDiagnostics } : {}),
            },
            committedAt: this.now(),
          }),
        commit: commitChanges,
      });
      return { messageReceipts: committed.result.messageReceipts };
    },
    { persistenceContext },
  );
}
