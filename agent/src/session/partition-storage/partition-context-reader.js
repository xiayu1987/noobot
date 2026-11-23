/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  isContextSourceMessageCandidate,
  readIndexedContextWindow,
} from "@noobot/context-protocol/assembly/source";
import { projectTurnMessage } from "@noobot/session-protocol";
import { createContextReadBudget } from "@noobot/session-protocol/context-read-budget";
import { readDirectoryOrdinals } from "@noobot/session-protocol/ordinal-directory";
import {
  partitionContextDialogKey,
  partitionContextDialogPageKey,
  partitionContextCandidatePageKey,
  requirePartitionContextDescriptor,
} from "@noobot/session-protocol/partition-context-index";
import {
  requirePartitionDialog,
  readPartitionLifecycleHeader,
} from "@noobot/session-protocol/partition-session-state";
import {
  PARTITION_MESSAGE_COLLECTIONS,
  requirePartitionVisibleMessageTurnOwnership,
  readPartitionSessionMessageCount,
  partitionMessageEntryKey,
} from "@noobot/session-protocol/partition-session-messages";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";
import { checkMessage, readPartitionMessageBody } from "./partition-message-reader.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

async function readDialogCandidates({
  get,
  read,
  snapshot,
  scope,
  dialog,
  descriptor,
  budget,
  active,
}) {
  const records = [];
  const turns = {};
  const visited = new Set();
  budget.assertAvailable("candidates", descriptor.count);
  let count = 0;
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const positions = pending;
    pending = [];
    if (positions.some((ordinal) => ordinal > active.count))
      corrupt("Context index references a deleted message");
    const { sessionOrder } = PARTITION_MESSAGE_COLLECTIONS;
    const keys = positions.map((ordinal) =>
      partitionMessageEntryKey(sessionOrder, scope.sessionId, ordinal),
    );
    const order = await read({ collection: sessionOrder, keys });
    const uids = keys.map((key) => {
      const uid = order.get(key)?.value;
      if (typeof uid !== "string" || !uid) corrupt("Context candidate has no session position");
      return uid;
    });
    const values = await read({ collection: "messages", keys: [...new Set(uids)] });
    const page = uids.map((messageUid, index) => {
      const record = checkMessage(values.get(messageUid)?.value, {
        snapshot,
        scope,
        messageUid,
        dialogProcessId: dialog.dialogProcessId,
        generation: snapshot.sequence,
        indexed: true,
      });
      if (
        record.sessionOrdinal !== positions[index] ||
        !isContextSourceMessageCandidate(record.message)
      )
        corrupt("Context candidate metadata or position mismatch");
      return record;
    });
    const selected = page.filter(({ message: { turnScopeId } }) => {
      if (turnScopeId === active.scope?.turnScopeId) return false;
      if (!visited.has(turnScopeId)) {
        budget.consume("turns");
        visited.add(turnScopeId);
      }
      return true;
    });
    const { lifecycle } = await requirePartitionVisibleMessageTurnOwnership(read, selected);
    for (const record of selected) {
      const id = record.message.turnScopeId;
      const state = lifecycle.get(id);
      if (state !== null && state !== undefined) turns[id] = state;
      records.push({ record, lifecycle: state });
    }
  };
  for await (const ordinal of readDirectoryOrdinals((prefix) =>
    prefix
      ? get(
          "contextCandidateRanges",
          partitionContextCandidatePageKey(dialog.dialogProcessId, prefix),
        )
      : descriptor.directory,
  )) {
    budget.consume("candidates");
    count += 1;
    if (count > descriptor.count) corrupt("Context candidate count mismatch");
    pending.push(ordinal);
    if (pending.length === snapshot.limits.pageRecords) await flush();
  }
  if (count !== descriptor.count) corrupt("Context candidate count mismatch");
  await flush();
  records.reverse();
  return { records, turns };
}

async function materializeSelectedCandidates(read, { source, selected, snapshot }) {
  const messages = [];
  for (const { record, lifecycle } of source.records) {
    if (!selected.has(record.message.messageUid)) continue;
    const content = await readPartitionMessageBody(read, snapshot, record);
    messages.push({ ...projectTurnMessage(record.message, lifecycle), content });
  }
  return messages;
}

export class PartitionContextReader {
  #transactions;

  constructor(journal, scope) {
    this.#transactions = new PartitionSessionTransactions(journal, scope);
  }

  readContextSource(snapshot, { scope: activeScope, historyLimit, limits }) {
    const budget = createContextReadBudget(limits);
    return this.#transactions.read(
      snapshot,
      async (read, scope) => {
        const get = async (collection, key) =>
          (await read({ collection, keys: [key] })).get(key)?.value ?? null;
        return readIndexedContextWindow({
          scope: activeScope,
          historyLimit,
          async readLifecycle() {
            const { sequence, activeTurnScopeId } = await readPartitionLifecycleHeader(read);
            return { sequence, activeTurnScopeId };
          },
          async *readDialogs() {
            const count = await readPartitionSessionMessageCount(read);
            const ordinals = readDirectoryOrdinals((prefix) =>
              get("contextDialogRanges", partitionContextDialogPageKey(prefix)),
            );
            for await (const ordinal of ordinals) {
              budget.consume("dialogs");
              const id = await get("contextDialogRanges", partitionContextDialogKey(ordinal));
              if (typeof id !== "string" || !id) corrupt("Missing context dialog identity");
              const dialog = requirePartitionDialog(await get("dialogs", id), id);
              const descriptor = requirePartitionContextDescriptor(dialog.contextCandidates);
              if (dialog.dialogOrdinal !== ordinal || descriptor.count === 0)
                corrupt("Context dialog directory ownership mismatch");
              yield { dialogProcessId: id, descriptor: { dialog, descriptor, count } };
            }
          },
          async readDialog({ dialog, descriptor, count }) {
            const source = await readDialogCandidates({
              get,
              read,
              snapshot,
              scope,
              dialog,
              descriptor,
              budget,
              active: { scope: activeScope, count },
            });
            return {
              messages: source.records.map(({ record }) => record.message),
              turnLifecycle: { turns: source.turns },
              materialize: (selected) =>
                materializeSelectedCandidates(read, { source, selected, snapshot }),
            };
          },
        });
      },
      { consumeReadBytes: (bytes) => budget.consume("bytes", bytes) },
    );
  }
}
