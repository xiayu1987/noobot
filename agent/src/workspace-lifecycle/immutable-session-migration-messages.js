/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireForwardSessionMessagePage } from "@noobot/session-protocol/message-read-budget";

export async function* readMigrationMessageRecords(reader, selection, signal) {
  let cursor = null;
  let previousCount = null;
  const { generation } = reader;
  do {
    signal?.throwIfAborted();
    const page = await reader.readMessagePage({ ...selection, direction: "forward", cursor });
    signal?.throwIfAborted();
    requireForwardSessionMessagePage(
      page,
      { generation, cursor, limit: selection.limit },
      previousCount,
    );
    yield* page.records;
    previousCount = page.messageCount;
    cursor = page.nextCursor;
  } while (cursor !== null);
}
