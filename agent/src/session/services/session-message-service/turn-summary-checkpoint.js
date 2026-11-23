/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { buildTurnEntity } from "./turn-upsert.js";
import { createSessionChangesSubmission } from "@noobot/session-protocol/session-changes";

export async function commitTurnSummaryCheckpoint(payload) {
  const request = parseTurnSummaryCheckpointRequest(payload);
  const { userId, sessionId } = request;
  const submission = payload.submission ?? createSessionChangesSubmission();
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
              messages: request.messages.map((message) =>
                buildTurnEntity(this, scope.resolvedParentSessionId, {
                  ...message,
                  userId,
                  sessionId,
                }),
              ),
              messageContentAppends: request.messageContentAppends,
              messageMetadataUpdates: request.messageMetadataUpdates,
              summaryCheckpoints: [request],
            },
            committedAt: this.now(),
          }),
        commit: commitChanges,
      });
      return committed.result.summaryCheckpoints[0];
    },
    { persistenceContext: payload.persistenceContext },
  );
}
