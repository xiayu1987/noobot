/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import {
  isCanonicalCommandReceipt,
  matchesAttachmentBindingReceipt,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { immutableStorageError } from "@noobot/session-protocol/immutable-storage";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { readPartitionCommandReceipt } from "@noobot/session-protocol/partition-session-state";
import { PartitionSessionMessages } from "../session/partition-storage/partition-session-messages.js";
import { PartitionTransactions } from "../session/partition-storage/partition-transactions.js";
import {
  immutableAttachmentBindingKey,
  immutableLifecycleCommandKey,
} from "../session/session-artifact-session/immutable-command-index.js";

async function verifySourceBinding(source, id, receipt) {
  const uid = receipt?.result?.messageUid;
  if (typeof uid !== "string" || !uid)
    throw immutableStorageError(`Invalid source attachment binding receipt: ${id}`);
  const message = await source.readBindingMessage(uid);
  if (
    message?.sessionId !== source.scope.sessionId ||
    message.messageUid !== uid ||
    !matchesAttachmentBindingReceipt(receipt, id, message) ||
    (await source.readBindingCommandId(uid)) !== id
  )
    throw immutableStorageError(`Invalid source attachment binding ownership: ${id}`);
}

export async function verifyImmutableSessionCommands({ source, journal, scope, snapshot, signal }) {
  const transactions = new PartitionTransactions(journal);
  const messages = new PartitionSessionMessages(journal, scope);
  const targetReceipt = (id) =>
    transactions.withCollectionReader(snapshot, (read) => readPartitionCommandReceipt(read, id));
  const targetMessage = (messageUid) => messages.readVisibleBindingRecord({ snapshot, messageUid });
  await source.visitCollection("commands", async (key, value) => {
    signal?.throwIfAborted();
    if (typeof value === "string") {
      const receipt = await source.readCommand(value);
      if (
        receipt?.type !== SESSION_COMMAND.TURN_ATTACHMENTS_BIND ||
        key !== immutableAttachmentBindingKey(receipt.result?.messageUid)
      )
        throw immutableStorageError(`Orphan source attachment binding index: ${key}`);
      return;
    }
    if (!isCanonicalCommandReceipt(value) || key !== immutableLifecycleCommandKey(value.commandId))
      throw immutableStorageError(`Invalid source command receipt: ${key}`);
    const { commandId, type } = value;
    if (type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND)
      await verifySourceBinding(source, commandId, value);
    if (!isDeepStrictEqual(await targetReceipt(commandId), value))
      throw immutableStorageError(`Staged command receipt differs from source: ${commandId}`);
  });
  await transactions.visitCollectionKeys(snapshot, ["commands"], async (key) => {
    signal?.throwIfAborted();
    const receipt = await targetReceipt(key);
    if (receipt === null) return;
    if (receipt.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND) {
      const record = await targetMessage(receipt.result.messageUid);
      if (
        record?.attachmentBindingCommandId !== key ||
        !matchesAttachmentBindingReceipt(receipt, key, record.message)
      )
        throw immutableStorageError(
          `Staged attachment binding has no matching visible message: ${key}`,
        );
    }
    if (!isDeepStrictEqual(await source.readCommand(key), receipt))
      throw immutableStorageError(`Staged session has an extra command receipt: ${key}`);
  });
  await transactions.visitCollectionKeys(
    snapshot,
    [PARTITION_MESSAGE_COLLECTIONS.messages],
    async (uid) => {
      signal?.throwIfAborted();
      const record = await targetMessage(uid);
      if (record === null || !Object.hasOwn(record, "attachmentBindingCommandId")) return;
      const id = record.attachmentBindingCommandId;
      if (!matchesAttachmentBindingReceipt(await targetReceipt(id), id, record.message))
        throw immutableStorageError(`Orphan staged attachment binding marker: ${uid}`);
    },
  );
}
