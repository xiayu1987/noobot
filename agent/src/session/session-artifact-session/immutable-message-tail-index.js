/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDialogAnchorMessageRecord } from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { immutableOrderKey } from "./immutable-order-key.js";

export const IMMUTABLE_MESSAGE_TAIL_VERSION = 3;

export async function requireImmutableMessageTailIndex(plan) {
  if ((await plan.get("metadata", "messageTailIndex"))?.version !== IMMUTABLE_MESSAGE_TAIL_VERSION)
    throw Object.assign(new Error("Immutable message tails require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
}

export async function readImmutableDialogTail(plan, dialogProcessId) {
  const tail = await plan.get("dialogTails", dialogProcessId);
  if (
    !tail ||
    ["messageUid", "previousDialogProcessId", "nextDialogProcessId"].some(
      (key) => typeof tail[key] !== "string" || tail[key].trim() !== tail[key],
    ) ||
    tail.previousDialogProcessId === dialogProcessId ||
    tail.nextDialogProcessId === dialogProcessId
  )
    throw immutableStorageError("Invalid dialog message tail");
  return tail;
}

export function seedImmutableMessageTails(plan, dialogs) {
  const ordered = [...dialogs].sort((a, b) => a.dialogOrdinal - b.dialogOrdinal);
  for (let index = 0; index < ordered.length; index += 1) {
    plan.set("dialogTails", ordered[index].dialogProcessId, {
      messageUid: "",
      previousDialogProcessId: ordered[index - 1]?.dialogProcessId ?? "",
      nextDialogProcessId: ordered[index + 1]?.dialogProcessId ?? "",
    });
  }
  plan.set("metadata", "messageTailIndex", { version: IMMUTABLE_MESSAGE_TAIL_VERSION });
}

export async function registerImmutableDialogTail(plan, facts, dialogProcessId) {
  let previousDialogProcessId = "";
  if (facts.lastMessageUid) {
    previousDialogProcessId = await plan.get(
      "dialogOrder",
      immutableOrderKey(facts.lastDialogOrdinal),
    );
    if (typeof previousDialogProcessId !== "string" || !previousDialogProcessId)
      throw immutableStorageError("Message tail facts reference a missing dialog");
    const previous = await readImmutableDialogTail(plan, previousDialogProcessId);
    if (previous.nextDialogProcessId || previous.messageUid !== facts.lastMessageUid)
      throw immutableStorageError("Latest dialog tail disagrees with session facts");
    plan.set("dialogTails", previousDialogProcessId, {
      ...previous,
      nextDialogProcessId: dialogProcessId,
    });
  }
  plan.set("dialogTails", dialogProcessId, {
    messageUid: "",
    previousDialogProcessId,
    nextDialogProcessId: "",
  });
}

export async function appendImmutableMessageTail(plan, message) {
  const tail = await readImmutableDialogTail(plan, message.dialogProcessId);
  if ((await plan.get("messagePredecessors", message.messageUid)) !== null)
    throw immutableStorageError("New message already has a tail membership");
  const previous = tail.messageUid
    ? await readImmutableMessagePredecessor(plan, tail.messageUid)
    : null;
  plan.set("messagePredecessors", message.messageUid, {
    previousMessageUid: tail.messageUid,
    userMessageUid: isDialogAnchorMessageRecord(message)
      ? message.messageUid
      : (previous?.userMessageUid ?? ""),
  });
  plan.set("dialogTails", message.dialogProcessId, { ...tail, messageUid: message.messageUid });
}

export async function readImmutableMessagePredecessor(plan, messageUid) {
  const entry = await plan.get("messagePredecessors", messageUid);
  if (
    !entry ||
    Object.keys(entry).length !== 2 ||
    ["previousMessageUid", "userMessageUid"].some(
      (key) => typeof entry[key] !== "string" || entry[key].trim() !== entry[key],
    ) ||
    entry.previousMessageUid === messageUid
  )
    throw immutableStorageError("Invalid message predecessor index");
  return entry;
}

async function unlinkDialog(plan, dialogProcessId, tail) {
  for (const [neighborId, ownLink] of [
    [tail.previousDialogProcessId, "nextDialogProcessId"],
    [tail.nextDialogProcessId, "previousDialogProcessId"],
  ]) {
    if (!neighborId) continue;
    const neighbor = await readImmutableDialogTail(plan, neighborId);
    if (neighbor[ownLink] !== dialogProcessId)
      throw immutableStorageError("Dialog tail neighbor relation mismatch");
    plan.set("dialogTails", neighborId, { ...neighbor, [ownLink]: tail[ownLink] });
  }
  plan.remove("dialogTails", dialogProcessId);
}

async function readTailPredecessor(plan, { messageUid, dialogProcessId, record }) {
  const previous = await plan.get("messages", messageUid);
  if (
    previous?.message?.messageUid !== messageUid ||
    previous.message.sessionId !== record.message.sessionId ||
    previous.message.dialogProcessId !== dialogProcessId ||
    !Number.isSafeInteger(previous.ordinal) ||
    previous.ordinal < 1 ||
    previous.ordinal >= record.ordinal ||
    (await plan.get("messageOrder", immutableOrderKey(previous.ordinal))) !== messageUid
  )
    throw immutableStorageError("Message tail predecessor ownership or position mismatch");
  return previous;
}

export async function removeImmutableMessageTail(plan, facts, record) {
  const { message } = record;
  const tail = await readImmutableDialogTail(plan, message.dialogProcessId);
  if (tail.messageUid !== message.messageUid)
    throw immutableStorageError("Message deletion is not a dialog suffix");
  const { previousMessageUid: previousUid } = await readImmutableMessagePredecessor(
    plan,
    message.messageUid,
  );
  let previous = null;
  if (previousUid) {
    previous = await readTailPredecessor(plan, {
      messageUid: previousUid,
      dialogProcessId: message.dialogProcessId,
      record,
    });
    plan.set("dialogTails", message.dialogProcessId, { ...tail, messageUid: previousUid });
  } else {
    const membership = await plan.get("dialogTurns", message.dialogProcessId);
    const turn = await plan.get("turns", message.turnScopeId);
    if (
      membership?.count !== 1 ||
      turn?.messageCount !== 1 ||
      turn.dialogProcessId !== message.dialogProcessId
    )
      throw immutableStorageError(
        "Message predecessor is missing while the dialog retains messages",
      );
    await unlinkDialog(plan, message.dialogProcessId, tail);
  }
  plan.remove("messagePredecessors", message.messageUid);
  if (facts.lastMessageUid !== message.messageUid) return;
  await updateSessionTailFacts({ plan, facts, previous, tail, record });
}

async function updateSessionTailFacts({ plan, facts, previous, tail, record }) {
  if (!previous && tail.previousDialogProcessId) {
    const previousTail = await readImmutableDialogTail(plan, tail.previousDialogProcessId);
    previous = await readTailPredecessor(plan, {
      messageUid: previousTail.messageUid,
      dialogProcessId: tail.previousDialogProcessId,
      record,
    });
  }
  const dialog = previous ? await plan.get("dialogs", previous.message.dialogProcessId) : null;
  if (previous && (!dialog || dialog.dialogOrdinal > facts.lastDialogOrdinal))
    throw immutableStorageError("Previous message tail dialog order mismatch");
  facts.lastMessageUid = previous?.message.messageUid ?? "";
  facts.lastMessageOrdinal = previous?.ordinal ?? 0;
  facts.lastDialogOrdinal = dialog?.dialogOrdinal ?? 0;
}
