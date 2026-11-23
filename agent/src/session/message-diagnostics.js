/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  messageDiagnosticKey,
  messageDiagnosticTurnKey,
  messageDiagnosticSourceId,
  requireMessageDiagnosticCursor,
  requireMessageDiagnosticPageRequest,
} from "@noobot/session-protocol/session-changes";
import { partitionExecutionLogRecords } from "@noobot/session-protocol";

async function readSequence(storage, key = "head") {
  const head = await storage.get("messageDiagnostics", key);
  if (head === null) return 0;
  try {
    requireMessageDiagnosticCursor(head);
    if (head.sequence === 0) throw new TypeError("Diagnostic stream head cannot be empty");
  } catch (cause) {
    if (!(cause instanceof TypeError)) throw cause;
    throw Object.assign(storage.storageError(cause.message), { cause });
  }
  return head.sequence;
}

function nextSequence(storage, sequence) {
  if (!Number.isSafeInteger(sequence + 1))
    throw storage.storageError("Diagnostic stream sequence is exhausted");
  return sequence + 1;
}

export async function prepareMessageDiagnostics(storage, diagnostics) {
  if (!diagnostics.length) return;
  let sequence = await readSequence(storage);
  const metadata = await storage.get("metadata", "session");
  for (const { messageUid, record } of diagnostics) {
    const turnKey = messageDiagnosticTurnKey(record.dialogProcessId);
    const turnSequence = nextSequence(storage, await readSequence(storage, turnKey));
    sequence = nextSequence(storage, sequence);
    storage.set("messageDiagnostics", messageDiagnosticKey(sequence), {
      messageUid,
      sequence,
      record: { ...record, parentSessionId: metadata.parentSessionId },
    });
    storage.set(
      "messageDiagnostics",
      messageDiagnosticTurnKey(record.dialogProcessId, turnSequence),
      sequence,
    );
    storage.set("messageDiagnostics", turnKey, { version: 1, sequence: turnSequence });
  }
  storage.set("messageDiagnostics", "head", { version: 1, sequence });
}

export async function readMessageDiagnosticPage(storage, options, dialogProcessId) {
  requireMessageDiagnosticPageRequest(options);
  const { after, limit } = options;
  const turnKey =
    dialogProcessId === undefined ? undefined : messageDiagnosticTurnKey(dialogProcessId);
  const sequence = await readSequence(storage, turnKey);
  if (after > sequence) throw storage.storageError("Diagnostic cursor exceeds source boundary");
  const end = Math.min(sequence, after + limit);
  let keys = [];
  for (let position = after + 1; position <= end; position += 1)
    keys.push(messageDiagnosticKey(position));
  let positions;
  if (dialogProcessId !== undefined) {
    const turnKeys = [];
    for (let position = after + 1; position <= end; position += 1)
      turnKeys.push(messageDiagnosticTurnKey(dialogProcessId, position));
    const links = await storage.getMany("messageDiagnostics", turnKeys);
    positions = turnKeys.map((key) => links.get(key));
    keys = positions.map((position) => {
      if (!Number.isSafeInteger(position) || position < 1)
        throw storage.storageError("Diagnostic stream position is missing or invalid");
      return messageDiagnosticKey(position);
    });
  }
  const records = await storage.getMany("messageDiagnostics", keys);
  const entries = keys.map((key, index) => {
    const value = records.get(key);
    const position = positions ? positions[index] : after + index + 1;
    if (
      !value ||
      value.sequence !== position ||
      value.record?.sessionId !== storage.sessionId ||
      (dialogProcessId !== undefined && value.record.dialogProcessId !== dialogProcessId) ||
      value.messageUid !== value.record.data?.artifactRef?.messageUid
    )
      throw storage.storageError("Diagnostic stream record is missing or has invalid ownership");
    return {
      record: value.record,
      sourceId: messageDiagnosticSourceId(storage.sessionId, position),
    };
  });
  const batches = [...partitionExecutionLogRecords(entries.map(({ record }) => record))];
  const count = batches[0]?.length ?? 0;
  return {
    entries: entries.slice(0, count),
    sequence: after + count,
    pending: after + count < sequence,
  };
}
