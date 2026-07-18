/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";

export async function markSessionMessagesSummarized({
    userId,
    sessionId,
    parentSessionId = "",
    shouldMark = null,
  } = {}) {
    if (!userId || !sessionId) return 0;
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this.sessionRepo.resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
    );
    if (!session) return 0;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    let updatedCount = 0;
    session.messages = messages.map((messageItem) => {
      const shouldUpdate =
        typeof shouldMark === "function" ? shouldMark(messageItem) : true;
      if (!shouldUpdate || messageItem?.summarized === true) return messageItem;
      updatedCount += 1;
      return { ...messageItem, summarized: true };
    });
    if (updatedCount > 0) {
      await this.sessionRepo.save(userId, session, resolvedParentSessionId);
    }
    return updatedCount;
    });
  }

export async function getSessionTurns({ userId, sessionId }) {
    const session = await this.sessionRepo.findById(userId, sessionId);
    return session?.messages || [];
  }

export async function hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
  }) {
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId,
    });
    if (!normalizedDialogProcessId) return false;
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      parentSessionId,
    );
    if (!session) return false;
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return messages.some(
      (messageItem) =>
        resolveMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
    );
  }
