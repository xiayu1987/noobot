/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { text } from "@noobot/shared/value";

export async function recordUserMetaParsedResult(payload = {}) {
  const { userId, sessionId, persistenceContext } = payload;
  const sourceMessageUid = text(payload.userMetaSourceMessageUid);
  if (!userId || !sessionId || !sourceMessageUid) {
    throw new TypeError("user_meta parsed result requires userId, sessionId and source messageUid");
  }
  return this.sessionRepo.withSessionReader(
    userId,
    sessionId,
    async (reader, _scope, commitChanges) => {
      const committed = await commitChanges({
        expectedGeneration: reader.generation,
        operationId: randomUUID(),
        changes: {
          userMetaParsedResult: { messageUid: sourceMessageUid, result: payload.result },
        },
        committedAt: this.now(),
      });
      return committed.result.userMetaParsedResult;
    },
    { persistenceContext },
  );
}
