/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createEmptyTurnLifecycle,
  createSessionNotFoundError,
  normalizeDialogProcessId,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { repairOrphanedTerminalTurns } from "@noobot/authoritative-state/application";
import { text } from "@noobot/shared/value";
import { readTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";

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
  dialogProcessId,
  turnScopeId,
}) {
  if (!text(userId) || !text(sessionId)) {
    throw new TypeError("getTurnSummaryCheckpointState requires userId and sessionId");
  }
  const session = await this.sessionRepo.findById(userId, sessionId, { persistenceContext });
  if (!session) throw createSessionNotFoundError({ userId, sessionId });
  return structuredClone(readTurnSummaryCheckpointState(session, { dialogProcessId, turnScopeId }));
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
