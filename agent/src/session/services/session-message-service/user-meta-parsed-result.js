/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_NOT_FOUND_REASON } from "@noobot/session-protocol";
import { mergeUserMetaParsedResults } from "@noobot/context-protocol/policy/user-meta-backwrite";
import { resolveDeletedSessionAs } from "./session-deleted-result.js";
import { text } from "@noobot/shared/value";

function userMetaSourceError(message, code) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function findUserMetaSource(messages = [], sourceMessageUid = "") {
  const source = messages.find((message) => text(message?.messageUid) === sourceMessageUid);
  if (!source) {
    throw userMetaSourceError(
      `user_meta source message not found: ${sourceMessageUid}`,
      "USER_META_SOURCE_NOT_FOUND",
    );
  }
  if (source.role !== "user") {
    throw userMetaSourceError(
      `user_meta source must be a user message: ${sourceMessageUid}`,
      "USER_META_SOURCE_ROLE_CONFLICT",
    );
  }
  return source;
}

export async function recordUserMetaParsedResult(payload = {}) {
  const { userId, sessionId, persistenceContext } = payload;
  const sourceMessageUid = text(payload.userMetaSourceMessageUid);
  if (!userId || !sessionId || !sourceMessageUid) {
    throw new TypeError("user_meta parsed result requires userId, sessionId and source messageUid");
  }
  const mutation = this.sessionRepo.withSessionMutation(
    userId,
    sessionId,
    async () => {
      const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
      if (!session) return { recorded: false, reason: SESSION_NOT_FOUND_REASON };
      const source = findUserMetaSource(session.messages, sourceMessageUid);
      source.userMetaParsedResults = mergeUserMetaParsedResults(
        source.userMetaParsedResults,
        payload.result,
      );
      session.updatedAt = this.now();
      await this.sessionRepo.save(userId, session, { persistenceContext });
      return { recorded: true, userMetaParsedResults: source.userMetaParsedResults };
    },
    { persistenceContext },
  );
  return resolveDeletedSessionAs(mutation, { recorded: false });
}
