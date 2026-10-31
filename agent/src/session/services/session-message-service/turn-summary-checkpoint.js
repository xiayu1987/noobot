/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSessionNotFoundError } from "@noobot/session-protocol";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { applyTurnSummaryCheckpoint } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";

export async function commitTurnSummaryCheckpoint(payload) {
  const request = parseTurnSummaryCheckpointRequest(payload);
  const { userId, sessionId, persistenceContext } = request;
  return this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      if (!session) throw createSessionNotFoundError({ userId, sessionId });
      const result = applyTurnSummaryCheckpoint(session, request, this.now());
      if (result.committed) await this.sessionRepo.save(userId, session, { persistenceContext });
      return result;
    },
    { persistenceContext },
  );
}
