/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import {
  decodeSessionMessagePreview,
  sessionMessagePreviewLimits,
} from "@noobot/session-protocol/message-preview";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { buildMessageSummary } from "../session-summary-builders/message-summary-projection.js";
import { readSessionOrderRecord } from "./partition-message-reader.js";
import { readPartitionContentRange } from "./partition-message-content.js";

export async function readPartitionMessagePreview(read, record) {
  const bytes = await readPartitionContentRange(read, record, {
    byteOffset: 0,
    maxBytes: sessionMessagePreviewLimits().jsonBytes,
  });
  try {
    return decodeSessionMessagePreview(bytes, record.contentBytes);
  } catch (cause) {
    if (!(cause instanceof TypeError) && !(cause instanceof SyntaxError)) throw cause;
    throw Object.assign(
      partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid list message preview"),
      { cause },
    );
  }
}

export async function readPartitionListProjection({ read, snapshot, scope }) {
  const messageCount = await readPartitionSessionMessageCount(read);
  if (messageCount === 0) return { messageCount, lastMessage: null };
  const record = await readSessionOrderRecord({ read, snapshot, scope }, messageCount);
  await requirePartitionVisibleMessageTurnOwnership(read, [record]);
  const preview = await readPartitionMessagePreview(read, record);
  return {
    messageCount,
    lastMessage: {
      ...buildMessageSummary({ ...record.message, content: preview.content }),
      ...preview,
    },
  };
}
