/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { requireSessionTurnViewSelection } from "@noobot/session-protocol";
import { readTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";

export async function getSessionTurns({
  userId,
  sessionId,
  turnScopeId,
  dialogProcessId,
  persistenceContext,
}) {
  if (turnScopeId !== undefined || dialogProcessId !== undefined) {
    const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
    const { session } = await this.sessionRepo.requireTurnView(userId, sessionId, {
      turnScopeIds: [lookupKey.turnScopeId],
      persistenceContext,
    });
    return session.messages.filter(
      (message) => message.dialogProcessId === lookupKey.dialogProcessId,
    );
  }
  const session = await this.sessionRepo.requireById(userId, sessionId, { persistenceContext });
  return session.messages;
}

export async function getSessionMessageSources({
  userId,
  sessionId,
  persistenceContext,
  messageUids,
  turnScopeIds,
}) {
  const selection = requireSessionTurnViewSelection({ turnScopeIds, messageUids });
  if (!selection.messageUids.length) return [];
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  return await Promise.all(
    selection.messageUids.map(async (uid) => {
      const record = await reader.readMessage(uid);
      if (!record) throw new Error(`Session message source is missing: ${uid}`);
      return record.message;
    }),
  );
}

export async function getSessionContextSource({
  userId,
  sessionId,
  persistenceContext,
  scope,
  historyLimit,
}) {
  return this.sessionRepo.requireContextSource(userId, sessionId, {
    persistenceContext,
    scope,
    historyLimit,
  });
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
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  const state = await reader.readCheckpointState(turnScopeId);
  const source = state ? { turnSummaryCheckpoints: { [turnScopeId]: state } } : {};
  return structuredClone(readTurnSummaryCheckpointState(source, { dialogProcessId, turnScopeId }));
}
