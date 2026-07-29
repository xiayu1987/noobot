/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";

export async function markSessionMessagesSummarized({
    userId,
    sessionId,
    dialogProcessId = "",
    turnScopeId = "",
    parentSessionId = "",
    persistenceContext = null,
    shouldMark = null,
  } = {}) {
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({
      dialogProcessId,
    });
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!userId || !sessionId || !normalizedDialogProcessId) return 0;
    return this._withSessionMutation(userId, sessionId, async () => {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    if (!session) return 0;
    const messages = Array.isArray(session.messages) ? session.messages : [];
    let updatedCount = 0;
    session.messages = messages.map((messageItem) => {
      const belongsToDialog =
        resolveMessageDialogProcessId(messageItem) === normalizedDialogProcessId;
      const belongsToTurn = !normalizedTurnScopeId ||
        String(messageItem?.turnScopeId || "").trim() === normalizedTurnScopeId;
      const shouldUpdate =
        belongsToDialog && belongsToTurn &&
        (typeof shouldMark === "function" ? shouldMark(messageItem) : true);
      if (!shouldUpdate || messageItem?.summarized === true) return messageItem;
      updatedCount += 1;
      return { ...messageItem, summarized: true };
    });
    if (updatedCount > 0) {
      await this.sessionRepo.save(userId, session, resolvedParentSessionId, { persistenceContext });
    }
    return updatedCount;
    }, parentSessionId, persistenceContext);
  }

export async function getSessionTurns({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
  } = {}) {
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    return session?.messages || [];
  }

export async function getSessionContextSource({ userId, sessionId }) {
    const session = await this.sessionRepo.findById(userId, sessionId);
    return {
      messages: Array.isArray(session?.messages) ? session.messages : [],
      dialogOrder: Array.isArray(session?.dialogOrder) ? session.dialogOrder : [],
    };
  }

export async function getTurnSummaryCheckpointState({
    userId,
    sessionId,
    parentSessionId = "",
    persistenceContext = null,
    dialogProcessId = "",
    turnScopeId = "",
  } = {}) {
    const normalizedDialogProcessId = resolveDialogProcessIdFromContext({ dialogProcessId });
    const normalizedTurnScopeId = String(turnScopeId || "").trim();
    if (!userId || !sessionId || !normalizedDialogProcessId || !normalizedTurnScopeId) return null;
    const resolvedParentSessionId = await this._resolveParentSessionId(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    const session = await this.sessionRepo.findById(
      userId,
      sessionId,
      resolvedParentSessionId,
      persistenceContext,
    );
    const state = session?.turnSummaryCheckpoints?.[normalizedTurnScopeId];
    if (!state || String(state?.dialogProcessId || "").trim() !== normalizedDialogProcessId) return null;
    return structuredClone(state);
  }

export async function hasDialogProcessIdInSession({
    userId,
    sessionId,
    dialogProcessId = "",
    parentSessionId = "",
    persistenceContext = null,
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
