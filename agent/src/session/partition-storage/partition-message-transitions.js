/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";

export async function readPartitionMessageTransitions(view, mutations) {
  const collection = PARTITION_MESSAGE_COLLECTIONS.messages;
  const messages = mutations.filter((mutation) => mutation.collection === collection);
  const entities = messages
    .filter(({ owner }) => owner !== null)
    .map(({ key, owner }) => ({ key, owner }));
  const originals = new Map();
  for (let offset = 0; offset < entities.length; offset += view.pageRecords) {
    const entries = await view.getLatestByOwner({
      collection,
      entities: entities.slice(offset, offset + view.pageRecords),
    });
    for (const [key, entry] of entries) originals.set(key, entry);
  }
  return messages.map(({ key, owner, remove, value }) => {
    const before = owner === null ? null : originals.get(key)?.mutation.value;
    const after = remove ? null : value;
    if (
      (owner !== null && before?.message?.messageUid !== key) ||
      (remove && before === null) ||
      (after !== null && after?.message?.messageUid !== key)
    )
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Invalid message projection transition",
      );
    return { before, after };
  });
}
