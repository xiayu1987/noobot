/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { repairOrphanedTerminalTurns } from "@noobot/authoritative-state/application";
import { text } from "@noobot/shared/value";
import { readTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";

export async function getSessionTurns({ userId, sessionId, persistenceContext }) {
  const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
  return session.messages;
}

export async function getSessionContextSource({ userId, sessionId, persistenceContext }) {
  const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
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
  const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
  return structuredClone(readTurnSummaryCheckpointState(session, { dialogProcessId, turnScopeId }));
}
