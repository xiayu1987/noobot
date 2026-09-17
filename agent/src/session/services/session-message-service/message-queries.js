/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { normalizeDialogProcessId } from "@noobot/session-protocol";
import { repairOrphanedTerminalTurns } from "@noobot/authoritative-state/application";

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
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const repair = repairOrphanedTerminalTurns({
    messages,
    turnLifecycle: session?.turnLifecycle || {},
  });
  return {
    messages,
    turnLifecycle: repair.turnLifecycle,
    repairedOrphanedTurnScopeIds: repair.orphanedTurnScopeIds,
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
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
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
  if (!state || String(state?.dialogProcessId || "").trim() !== normalizedDialogProcessId)
    return null;
  return structuredClone(state);
}

export async function hasDialogProcessIdInSession({
  userId,
  sessionId,
  dialogProcessId = "",
  parentSessionId = "",
  persistenceContext = null,
}) {
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  if (!normalizedDialogProcessId) return false;
  const session = await this.sessionRepo.findById(userId, sessionId, parentSessionId);
  if (!session) return false;
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return messages.some(
    (messageItem) =>
      resolveContextMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
  );
}
