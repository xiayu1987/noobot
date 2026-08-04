/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDialogProcessIdFromContext, resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";

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

export async function getSessionContextSource({
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
  return {
    messages: Array.isArray(session?.messages) ? session.messages : [],
    turnStatuses: Array.isArray(session?.turnStatuses) ? session.turnStatuses : [],
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
