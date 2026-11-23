/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  messageReadJsonBytes,
  sessionMessagePageLength,
} from "@noobot/session-protocol/message-read-budget";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  createSessionDisplayArtifactSummary,
  sessionDisplayArtifactResultKey,
  sessionDisplayArtifactStateKey,
  sessionDisplayAssistantCountKey,
  sessionDisplayDependencyDirectory,
} from "@noobot/session-protocol/session-reader";
import { readTurnPosition } from "./partition-message-reader.js";
import { hasToolResultArtifacts } from "../session-summary-builders/turn-artifact-projection.js";

export const emptyArtifactState = Object.freeze({ count: 0, conflicts: 0, attachments: 0 });

export async function readArtifactState(get, turnScopeId) {
  const stored = await get("metadata", sessionDisplayArtifactStateKey(turnScopeId));
  if (stored === null) return emptyArtifactState;
  if (
    [stored.count, stored.conflicts, stored.attachments].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    stored.count === 0
  )
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid display artifact state");
  return stored;
}

export async function readDisplayAssistantCount(get, turnScopeId) {
  const count = await get("metadata", sessionDisplayAssistantCountKey(turnScopeId));
  if (count === null) return 0;
  if (!Number.isSafeInteger(count) || count < 1)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Invalid visible assistant count for display turn",
    );
  return count;
}

export async function readArtifactOwner(
  { read, identity, state: { membership, lifecycle }, directory },
  artifactCount,
  readAssistantCount,
) {
  if (artifactCount === 0 || (await readAssistantCount()) !== 1) return null;
  const first = await directory("assistants").first();
  if (first !== null && membership !== null) {
    const { dialogProcessId } = membership;
    const { message } = await readTurnPosition(read, { ...identity, dialogProcessId }, first);
    return message.presentationMessageId;
  }
  if (first === null && lifecycle != null) return lifecycle.presentationMessageId;
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing sole display presentation");
}

async function readIndexedDisplayArtifact({ read, get, identity }, turn, first) {
  const ordinal = await get(
    "metadata",
    sessionDisplayArtifactResultKey(identity.turnScopeId, first),
  );
  if (!Number.isSafeInteger(ordinal) || ordinal < first || ordinal > turn.messageCount)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Artifact dependency outside owning turn",
    );
  const record = await readTurnPosition(read, identity, ordinal);
  if (!hasToolResultArtifacts(record.message))
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Artifact index points to a message without artifacts",
    );
  return record;
}

export async function readPartitionDisplayArtifactPage(read, identity, turn, selection) {
  const { position, budget, limit } = selection;
  const get = async (collection, key) =>
    (await read({ collection, keys: [key] })).get(key)?.value ?? null;
  const { turnScopeId } = identity;
  const directory = (kind) =>
    sessionDisplayDependencyDirectory({ get: (key) => get("metadata", key) }, turnScopeId, kind);
  const order = directory("artifact-order");
  sessionMessagePageLength(position.after, turn.messageCount, limit);
  const state = await readArtifactState(get, turnScopeId);
  const owner = await readArtifactOwner(
    { read, identity, state: { membership: turn, lifecycle: turn.lifecycle }, directory },
    state.count,
    () => readDisplayAssistantCount(get, turnScopeId),
  );
  const summary = createSessionDisplayArtifactSummary(state, owner);
  budget.consume("bytes", messageReadJsonBytes(summary));
  const records = [];
  const source = { read, get, identity };
  let last = position.after;
  let nextCursor = null;
  for await (const first of order.ordinals({ after: position.after })) {
    if (records.length === limit) {
      nextCursor = { scope: position.scope, after: last };
      break;
    }
    const record = await readIndexedDisplayArtifact(source, turn, first);
    const { content: _content, ...metadata } = record.message;
    const entry = {
      ordinal: record.sessionOrdinal,
      message: {
        ...metadata,
        contentReference: record.contentVersion,
        contentBytes: record.contentBytes,
      },
    };
    budget.consume("bytes", messageReadJsonBytes(entry));
    records.push(entry);
    last = first;
  }
  if (records.length === 0) sessionMessagePageLength(position.after, 0, limit);
  if (
    records.length > state.count ||
    (position.after === 0 && nextCursor === null && records.length !== state.count)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Artifact order and published count disagree",
    );
  return { generation: identity.generation, summary, records, nextCursor };
}
