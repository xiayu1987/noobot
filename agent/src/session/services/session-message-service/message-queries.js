/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { requireSessionTurnViewSelection } from "@noobot/session-protocol";
import { readTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import { requireMessageContentPage } from "@noobot/session-protocol/message-read-budget";
import { readRequiredMessageContentPage } from "../../session-message-content-page.js";

export async function getSessionMessageContentPage({
  userId,
  sessionId,
  persistenceContext,
  messageUid,
  byteOffset,
  maxBytes,
  expectedContentReference,
}) {
  const selection = { messageUid, byteOffset, maxBytes, expectedContentReference };
  requireMessageContentPage(selection);
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  return await readRequiredMessageContentPage(reader, selection);
}

export async function getSessionTurnMessagePage({
  userId,
  sessionId,
  turnScopeId,
  dialogProcessId,
  cursor,
  limit,
  maxBytes,
  persistenceContext,
}) {
  const lookupKey = requireTurnLookupKey({ turnScopeId, dialogProcessId });
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  return await reader.readScopedTurnMessagePage({ lookupKey, cursor, limit, maxBytes });
}

export async function getSessionMessageSources({
  userId,
  sessionId,
  persistenceContext,
  messageUids,
  turnScopeIds,
  maxBytes,
}) {
  const selection = requireSessionTurnViewSelection({ turnScopeIds, messageUids });
  if (!selection.messageUids.length) return [];
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  const records = await reader.readMessages({ messageUids: selection.messageUids, maxBytes });
  return records.map((record, position) => {
    if (!record)
      throw new Error(`Session message source is missing: ${selection.messageUids[position]}`);
    return record.message;
  });
}

export async function getSessionContextSource({
  userId,
  sessionId,
  persistenceContext,
  scope,
  historyLimit,
  limits,
}) {
  return this.sessionRepo.requireContextSource(userId, sessionId, {
    persistenceContext,
    scope,
    historyLimit,
    limits,
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
