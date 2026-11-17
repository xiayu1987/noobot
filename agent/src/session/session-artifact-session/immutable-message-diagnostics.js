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
import { immutableStorageError } from "./immutable-object-store.js";

async function readSequence(get, key = "head") {
  const head = await get("messageDiagnostics", key);
  if (head === null) return 0;
  requireMessageDiagnosticCursor(head);
  if (head.sequence === 0) throw immutableStorageError("Diagnostic stream head cannot be empty");
  return head.sequence;
}

export async function prepareImmutableMessageDiagnostics(plan, diagnostics) {
  if (!diagnostics.length) return;
  let sequence = await readSequence((...args) => plan.get(...args));
  const metadata = await plan.get("metadata", "session");
  for (const { messageUid, record } of diagnostics) {
    const turnKey = messageDiagnosticTurnKey(record.dialogProcessId);
    const turnSequence = (await readSequence((...args) => plan.get(...args), turnKey)) + 1;
    sequence += 1;
    const key = messageDiagnosticKey(sequence);
    plan.set("messageDiagnostics", key, {
      messageUid,
      sequence,
      record: { ...record, parentSessionId: metadata.parentSessionId },
    });
    plan.set(
      "messageDiagnostics",
      messageDiagnosticTurnKey(record.dialogProcessId, turnSequence),
      sequence,
    );
    plan.set("messageDiagnostics", turnKey, { version: 1, sequence: turnSequence });
  }
  plan.set("messageDiagnostics", "head", { version: 1, sequence });
}

export async function readImmutableMessageDiagnosticPage(
  store,
  snapshot,
  options,
  dialogProcessId,
) {
  requireMessageDiagnosticPageRequest(options);
  const { after, limit } = options;
  const get = (collection, key) => store.get(snapshot, collection, key);
  const turnKey =
    dialogProcessId === undefined ? undefined : messageDiagnosticTurnKey(dialogProcessId);
  const sequence = await readSequence(get, turnKey);
  if (after > sequence) throw immutableStorageError("Diagnostic cursor exceeds source boundary");
  const end = Math.min(sequence, after + limit);
  let keys = [];
  for (let position = after + 1; position <= end; position += 1)
    keys.push(messageDiagnosticKey(position));
  let positions;
  if (dialogProcessId !== undefined) {
    const turnKeys = [];
    for (let position = after + 1; position <= end; position += 1)
      turnKeys.push(messageDiagnosticTurnKey(dialogProcessId, position));
    const links = await store.getMany(snapshot, "messageDiagnostics", turnKeys);
    positions = turnKeys.map((key) => links.get(key));
    keys = positions.map(messageDiagnosticKey);
  }
  const records = await store.getMany(snapshot, "messageDiagnostics", keys);
  const entries = keys.map((key, index) => {
    const value = records.get(key);
    const position = positions ? positions[index] : after + index + 1;
    if (
      !value ||
      value.sequence !== position ||
      value.record?.sessionId !== store.sessionId ||
      (dialogProcessId !== undefined && value.record.dialogProcessId !== dialogProcessId) ||
      value.messageUid !== value.record.data?.artifactRef?.messageUid
    )
      throw immutableStorageError("Diagnostic stream record is missing or has invalid ownership");
    return { record: value.record, sourceId: messageDiagnosticSourceId(store.sessionId, position) };
  });
  const batches = [...partitionExecutionLogRecords(entries.map(({ record }) => record))];
  const count = batches[0]?.length ?? 0;
  return {
    entries: entries.slice(0, count),
    sequence: after + count,
    pending: after + count < sequence,
  };
}
