/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { applyTurnSummaryCheckpoint } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";

export async function commitTurnSummaryCheckpoint(payload) {
  const request = parseTurnSummaryCheckpointRequest(payload);
  const { userId, sessionId, persistenceContext } = request;
  return this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
      const result = applyTurnSummaryCheckpoint(session, request, this.now());
      if (result.committed) await this.sessionRepo.save(userId, session, { persistenceContext });
      return result;
    },
    { persistenceContext },
  );
}
