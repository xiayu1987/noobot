/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  requireTurnLookupKey,
  matchesTurnLookupKey,
} from "@noobot/session-protocol/turn-lookup-key";
import { readImmutableTurnPage } from "./immutable-message-reader.js";

export async function readImmutableTurn({ store, snapshot, lookupKey }) {
  const key = requireTurnLookupKey(lookupKey);
  const descriptor = await store.get(snapshot, "turns", key.turnScopeId);
  if (descriptor === null || !matchesTurnLookupKey(descriptor, key)) return null;
  const lifecycle = await store.get(snapshot, "lifecycle", key.turnScopeId);
  const messages = [];
  let after = 0;
  let page;
  do {
    page = await readImmutableTurnPage({ store, snapshot, turnScopeId: key.turnScopeId, after });
    for (const record of page.records) messages.push(record.message);
    after = page.cursor;
  } while (page.hasMore);
  return {
    sessionId: store.sessionId,
    ...key,
    messages,
    contentRevision: `${descriptor.messagesRoot}:${lifecycle?.sequence ?? 0}`,
  };
}
