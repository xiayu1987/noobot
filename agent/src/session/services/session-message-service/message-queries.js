/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { createEmptyTurnLifecycle, normalizeDialogProcessId } from "@noobot/session-protocol";
import { repairOrphanedTerminalTurns } from "@noobot/authoritative-state/application";
import { text } from "@noobot/shared/value";

export async function getSessionTurns({
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
} = {}) {
  const { session } = await this._findSession(
    userId,
    sessionId,
    parentSessionId,
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
  const { session } = await this._findSession(
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!session) return { messages: [], turnLifecycle: createEmptyTurnLifecycle() };
  const repair = repairOrphanedTerminalTurns({
    messages: session.messages,
    turnLifecycle: session.turnLifecycle,
  });
  return { messages: session.messages, turnLifecycle: repair.turnLifecycle };
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
  const normalizedTurnScopeId = text(turnScopeId);
  if (!userId || !sessionId || !normalizedDialogProcessId || !normalizedTurnScopeId) return null;
  const { session } = await this._findSession(
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  const state = session?.turnSummaryCheckpoints?.[normalizedTurnScopeId];
  if (!state || text(state?.dialogProcessId) !== normalizedDialogProcessId) return null;
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
  const { session } = await this._findSession(
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  if (!session) return false;
  return session.messages.some(
    (messageItem) =>
      resolveContextMessageDialogProcessId(messageItem) === normalizedDialogProcessId,
  );
}
