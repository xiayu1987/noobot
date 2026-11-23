/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { requireTurnLookupKey } from "@noobot/session-protocol/turn-lookup-key";
import {
  requireThinkingDetailPageResponse,
  requireThinkingDetailPageSelection,
  requireThinkingDetailReleaseSelection,
} from "@noobot/session-protocol/message-read-budget";

function snapshotIdentity(identity, sessionId, key) {
  return [...identity, "thinking-detail", sessionId, key.dialogProcessId, key.turnScopeId];
}

export function releaseSessionThinkingDetail({
  pageSnapshots,
  identity,
  sessionId,
  lookupKey,
  cursor,
}) {
  const selection = requireThinkingDetailReleaseSelection({ sessionId, ...lookupKey, cursor });
  return pageSnapshots.releaseCursor({
    identity: snapshotIdentity(identity, sessionId, selection),
    cursor,
  });
}

export async function readSessionThinkingDetail({
  pageSnapshots,
  identity,
  open,
  sessionId,
  lookupKey,
  cursor,
  limit,
  maxBytes,
}) {
  const key = requireTurnLookupKey(lookupKey);
  const selection = requireThinkingDetailPageSelection({ sessionId, ...key, cursor, limit });
  const response = await pageSnapshots.read({
    identity: snapshotIdentity(identity, sessionId, key),
    cursor,
    open,
    read: async (reader, storageCursor) => {
      const page = await reader.readThinkingDetailPage({
        lookupKey: key,
        cursor: storageCursor,
        limit,
        maxBytes,
      });
      if (page === null) return null;
      return requireThinkingDetailPageResponse(
        {
          exists: true,
          sessionId,
          ...key,
          generation: page.generation,
          messageCount: page.messageCount,
          messages: page.records.map(({ message }) => message),
          nextCursor: page.nextCursor,
        },
        { ...selection, cursor: storageCursor },
      );
    },
  });
  return response === null
    ? requireThinkingDetailPageResponse({ exists: false }, selection)
    : response;
}
