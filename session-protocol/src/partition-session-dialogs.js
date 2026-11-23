/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDialogAnchorMessageRecord } from "./aggregate/session-message-record.js";
import {
  PARTITION_DIALOG_SEQUENCE,
  requirePartitionDialog,
  requirePartitionDialogSequence,
} from "./partition-session-state.js";
import { PartitionAdmissionRejection, partitionJournalError } from "./partition-journal.js";
import {
  partitionMessageEntryKey,
  requirePartitionMessageTurnOwnership,
} from "./partition-session-messages.js";
import { requireDialogTurnPage } from "./message-read-budget.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export async function requireFreshPartitionMessageIdentities(view, messages) {
  const owners = await view.getCreationOwners({
    collection: "messages",
    keys: messages.map(({ messageUid }) => messageUid),
  });
  if ([...owners.values()].some((owner) => owner !== null))
    throw new PartitionAdmissionRejection(
      "SESSION_ENTITY_EXISTS",
      "Message identity is already allocated",
    );
}

function prepareDialog(entry, { dialogProcessId, turnScopeId }, allocateOrdinal) {
  if (entry?.mutation.remove)
    throw new PartitionAdmissionRejection(
      "SESSION_ENTITY_EXISTS",
      "Dialog identity is already allocated",
    );
  return entry === null
    ? {
        dialogProcessId,
        turnScopeId,
        dialogOrdinal: allocateOrdinal(),
        userMessageUid: "",
        latestUserMessageUid: null,
        messageCount: 0,
        turnCount: 0,
        contextCandidates: { count: 0, directory: { ordinals: [] } },
      }
    : { ...requirePartitionDialog(entry.mutation.value, dialogProcessId) };
}

export function requireImportedDialogOrdinal(ordinal, sequence) {
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    ordinal > requirePartitionDialogSequence(sequence)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Imported dialog ordinal exceeds the source allocation",
    );
  return ordinal;
}

function requireMatchingImportedOrdinal(dialog, importedDialogOrdinal) {
  if (importedDialogOrdinal !== undefined && dialog.dialogOrdinal !== importedDialogOrdinal)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Imported dialog ordinal disagrees with its existing record",
    );
}

function registerDialogTurn(dialog, turnScopeId, { exists, mutations, positions }) {
  dialog.turnCount += 1;
  const position = {
    collection: "dialogTurns",
    key: partitionMessageEntryKey("dialogTurns", dialog.dialogProcessId, dialog.turnCount),
    value: turnScopeId,
  };
  if (exists) positions.push(position);
  else mutations.push({ ...position, owner: null });
}

function appendDialogUserAnchor(dialog, message, sourceDialog) {
  const advancesNaturalUserTail = isDialogAnchorMessageRecord(message);
  const establishesRegisteredUser =
    sourceDialog === undefined
      ? advancesNaturalUserTail && dialog.userMessageUid === ""
      : sourceDialog.userMessageUid === message.messageUid;
  if (establishesRegisteredUser) {
    if (message.role !== "user" || dialog.userMessageUid !== "")
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid registered dialog user");
    dialog.userMessageUid = message.messageUid;
  }
  if (advancesNaturalUserTail) dialog.latestUserMessageUid = message.messageUid;
}

export async function preparePartitionDialogs(view, { messages, turns, mutations, sourceDialog }) {
  const keys = [...new Set(messages.map(({ dialogProcessId }) => dialogProcessId))];
  const entries = await view.getLatestMany({ collection: "dialogs", keys });
  const dialogs = new Map();
  const registered = new Set();
  const positions = [];
  const previousUserMessages = new Map();
  let sequenceEntry;
  let sequence;
  const importing = sourceDialog !== undefined;
  const importedDialogOrdinal = sourceDialog?.dialogOrdinal;
  if (importing || keys.some((key) => entries.get(key) === null)) {
    const { collection, key } = PARTITION_DIALOG_SEQUENCE;
    sequenceEntry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
    sequence = requirePartitionDialogSequence(sequenceEntry?.mutation.value);
  }
  if (importing) {
    requireImportedDialogOrdinal(importedDialogOrdinal, sequence);
    if (keys.length !== 1 || keys[0] !== sourceDialog.dialogProcessId)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Imported dialog ownership mismatch");
  }
  for (const message of messages) {
    const { dialogProcessId, turnScopeId, messageUid } = message;
    if (!turns.has(turnScopeId))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing validated turn ownership");
    let dialog = dialogs.get(dialogProcessId);
    if (!dialog) {
      dialog = prepareDialog(entries.get(dialogProcessId), message, () =>
        importing ? importedDialogOrdinal : ++sequence,
      );
      requireMatchingImportedOrdinal(dialog, importedDialogOrdinal);
      dialogs.set(dialogProcessId, dialog);
    }
    dialog.messageCount += 1;
    if (turns.get(turnScopeId) === null && !registered.has(turnScopeId)) {
      registered.add(turnScopeId);
      registerDialogTurn(dialog, turnScopeId, {
        exists: entries.get(dialogProcessId) !== null,
        mutations,
        positions,
      });
    }
    previousUserMessages.set(messageUid, dialog.latestUserMessageUid);
    appendDialogUserAnchor(dialog, message, sourceDialog);
    requirePartitionDialog(dialog, dialogProcessId);
  }
  if (positions.length) {
    const owners = await view.getCreationOwners({
      collection: "dialogTurns",
      keys: positions.map(({ key }) => key),
    });
    for (const position of positions)
      mutations.push({ ...position, owner: owners.get(position.key) });
  }
  for (const [key, value] of dialogs) {
    const entry = entries.get(key);
    mutations.push({
      collection: "dialogs",
      key,
      owner: entry === null ? null : entry.owner,
      value,
    });
  }
  if (!importing && sequenceEntry !== undefined)
    mutations.push({
      ...PARTITION_DIALOG_SEQUENCE,
      owner: sequenceEntry.owner,
      value: requirePartitionDialogSequence(sequence),
    });
  return previousUserMessages;
}

async function removeDialogTurn(read, value, { message, turnOrdinal }) {
  if (turnOrdinal !== 1) return;
  const key = partitionMessageEntryKey("dialogTurns", message.dialogProcessId, value.turnCount);
  const position = (await read({ collection: "dialogTurns", keys: [key] })).get(key);
  if (position?.value !== message.turnScopeId)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Dialog turn suffix ownership mismatch");
  value.turnCount -= 1;
}

function removeDialogUserAnchor(dialog, message, previousDialogUserUid) {
  if (dialog.userMessageUid === message.messageUid) dialog.userMessageUid = "";
  if (!isDialogAnchorMessageRecord(message)) return;
  if (dialog.latestUserMessageUid !== message.messageUid)
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Dialog user tail disagrees with suffix",
    );
  dialog.latestUserMessageUid = previousDialogUserUid;
}

export async function removePartitionDialogMessages(read, records, dialogs) {
  const keys = [...new Set(records.map(({ message }) => message.dialogProcessId))].filter(
    (key) => !dialogs.has(key),
  );
  if (keys.length) {
    const entries = await read({ collection: "dialogs", keys, includeOwner: true });
    for (const key of keys) {
      const stored = entries.get(key);
      const value = {
        ...requirePartitionDialog(
          stored?.mutation.remove ? undefined : stored?.mutation.value,
          key,
        ),
      };
      dialogs.set(key, { collection: "dialogs", key, owner: stored.owner, value });
    }
  }
  for (const { message, turnOrdinal, previousDialogUserUid } of [...records].reverse()) {
    const { value } = dialogs.get(message.dialogProcessId);
    value.messageCount -= 1;
    await removeDialogTurn(read, value, { message, turnOrdinal });
    if (value.messageCount < 0)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Dialog message count disagrees with suffix",
      );
    removeDialogUserAnchor(value, message, previousDialogUserUid);
    if (value.messageCount === 0 ? value.turnCount !== 0 : value.turnCount < 1)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Dialog turn count disagrees with suffix",
      );
  }
}

export async function readPartitionDialogTurnPage(
  read,
  snapshot,
  {
    dialogProcessId,
    after = 0,
    limit = QUANTITY_THRESHOLDS.immutableStorage.messageReadPageSize,
    maxBytes,
  },
) {
  const budget = requireDialogTurnPage({ dialogProcessId, after, limit, maxBytes });
  const stored = (await read({ collection: "dialogs", keys: [dialogProcessId] })).get(
    dialogProcessId,
  );
  if (stored === null) return null;
  const dialog = requirePartitionDialog(stored.value, dialogProcessId);
  if (after > dialog.turnCount) throw new TypeError("Dialog cursor exceeds its pinned membership");
  const length = Math.min(limit, snapshot.limits.pageRecords, dialog.turnCount - after);
  const keys = [];
  for (let index = 0; index < length; index += 1)
    keys.push(partitionMessageEntryKey("dialogTurns", dialogProcessId, after + index + 1));
  const positions = keys.length ? await read({ collection: "dialogTurns", keys }) : new Map();
  const turnScopeIds = keys.map((key) => {
    const id = positions.get(key)?.value;
    if (typeof id !== "string" || !id || id.trim() !== id)
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Missing or invalid dialog turn position",
      );
    budget.consume("bytes", Buffer.byteLength(JSON.stringify(id)));
    return id;
  });
  const { turns } = await requirePartitionMessageTurnOwnership(
    read,
    turnScopeIds.map((turnScopeId) => ({ turnScopeId, dialogProcessId })),
  );
  if (
    new Set(turnScopeIds).size !== turnScopeIds.length ||
    turnScopeIds.some((id) => !turns.get(id) || turns.get(id).mutation.remove)
  )
    throw partitionJournalError(
      "SESSION_STORAGE_CORRUPT",
      "Dialog membership references a missing or duplicate turn",
    );
  return {
    generation: snapshot.sequence,
    turnScopeIds,
    cursor: after + length,
    hasMore: after + length < dialog.turnCount,
  };
}
