/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction } from "@noobot/shared/value";
import { requireDialogProcessKey } from "@noobot/session-protocol";

async function* readTurnRecords(reader, turnScopeId) {
  let after = 0;
  let page;
  do {
    page = await reader.readTurnPage({ turnScopeId, after });
    if (page === null) throw new Error("Pinned dialog membership references a missing turn");
    yield* page.records;
    after = page.cursor;
  } while (page.hasMore);
}

async function* readDialogRecords(reader, dialogProcessId) {
  let after = 0;
  let page;
  do {
    page = await reader.readDialogTurnPage({ dialogProcessId, after });
    if (page === null) return;
    for (const turnScopeId of page.turnScopeIds) yield* readTurnRecords(reader, turnScopeId);
    after = page.cursor;
  } while (page.hasMore);
}

export async function withSessionDialogMessageRecords(
  { userId, sessionId, dialogProcessId, persistenceContext },
  consume,
) {
  requireDialogProcessKey(dialogProcessId);
  if (!isFunction(consume)) throw new TypeError("Dialog message stream requires a consumer");
  await using reader = await this.sessionRepo.requireSessionReader(userId, sessionId, {
    persistenceContext,
  });
  const records = readDialogRecords(reader, dialogProcessId);
  try {
    return await consume(records);
  } finally {
    await records.return();
  }
}
