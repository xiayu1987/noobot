/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createEmptyTurnLifecycle,
  normalizeDialogProcessId,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { repairOrphanedTerminalTurns } from "@noobot/authoritative-state/application";
import { text } from "@noobot/shared/value";

export async function getSessionTurns({ userId, sessionId, persistenceContext } = {}) {
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  return session?.messages || [];
}

export async function getSessionContextSource({ userId, sessionId, persistenceContext } = {}) {
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
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
  persistenceContext,
  dialogProcessId = "",
  turnScopeId = "",
} = {}) {
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  const normalizedTurnScopeId = text(turnScopeId);
  if (!userId || !sessionId || !normalizedDialogProcessId || !normalizedTurnScopeId) return null;
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  const state = session?.turnSummaryCheckpoints?.[normalizedTurnScopeId];
  if (!state || text(state?.dialogProcessId) !== normalizedDialogProcessId) return null;
  return structuredClone(state);
}

export async function hasDialogProcessIdInSession({
  userId,
  sessionId,
  dialogProcessId = "",
  persistenceContext,
}) {
  const normalizedDialogProcessId = normalizeDialogProcessId(dialogProcessId);
  if (!normalizedDialogProcessId) return false;
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  if (!session) return false;
  return session.messages.some(
    (messageItem) =>
      resolveSessionMessageRecordDialogProcessId(messageItem) === normalizedDialogProcessId,
  );
}
