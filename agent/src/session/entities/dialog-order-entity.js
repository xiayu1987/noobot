/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isDialogAnchorMessage } from "@noobot/context-protocol/policy/message";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { isPlainObject, text } from "@noobot/shared/value";

function dialogOrderError(message, code = "SESSION_DIALOG_ORDER_INVALID") {
  const error = new TypeError(message);
  error.code = code;
  return error;
}

function normalizeDialogOrderItem(entry) {
  if (!isPlainObject(entry)) throw dialogOrderError("session dialogOrder entry must be an object");
  const dialogProcessId = text(entry.dialogProcessId);
  const { dialogOrdinal } = entry;
  if (!dialogProcessId || !Number.isSafeInteger(dialogOrdinal) || dialogOrdinal < 1) {
    throw dialogOrderError("session dialogOrder entry requires dialogProcessId and ordinal");
  }
  return {
    dialogProcessId,
    turnScopeId: text(entry.turnScopeId),
    userMessageUid: text(entry.userMessageUid),
    startedAt: text(entry.startedAt),
    dialogOrdinal,
  };
}

export function normalizeDialogOrderEntity(dialogOrder) {
  if (!Array.isArray(dialogOrder)) throw dialogOrderError("session dialogOrder must be an array");
  const entries = dialogOrder.map(normalizeDialogOrderItem);
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.dialogProcessId)) {
      throw dialogOrderError(`duplicate session dialogOrder entry: ${entry.dialogProcessId}`);
    }
    seen.add(entry.dialogProcessId);
  }
  return entries.sort((left, right) => left.dialogOrdinal - right.dialogOrdinal);
}

export function assertDialogOrderCoversMessages(dialogOrder, messages) {
  const registered = new Set(dialogOrder.map((entry) => entry.dialogProcessId));
  for (const message of messages) {
    const dialogProcessId = resolveContextMessageDialogProcessId(message);
    if (dialogProcessId && !registered.has(dialogProcessId)) {
      throw dialogOrderError(
        `session dialog is not registered: ${dialogProcessId}`,
        "SESSION_DIALOG_ORDER_UNREGISTERED",
      );
    }
  }
}

export function registerDialogOrderMessage(dialogOrder, message) {
  const dialogProcessId = resolveContextMessageDialogProcessId(message);
  if (!dialogProcessId) return dialogOrder;
  const anchorUid = isDialogAnchorMessage(message) ? text(message.messageUid) : "";
  const index = dialogOrder.findIndex((entry) => entry.dialogProcessId === dialogProcessId);
  if (index >= 0) {
    if (!anchorUid || dialogOrder[index].userMessageUid) return dialogOrder;
    return dialogOrder.map((entry, entryIndex) =>
      entryIndex === index
        ? { ...entry, userMessageUid: anchorUid, startedAt: text(message.ts) || entry.startedAt }
        : entry,
    );
  }
  const dialogOrdinal =
    dialogOrder.reduce((max, entry) => Math.max(max, entry.dialogOrdinal), 0) + 1;
  return [
    ...dialogOrder,
    {
      dialogProcessId,
      turnScopeId: text(message.turnScopeId),
      userMessageUid: anchorUid,
      startedAt: text(message.ts),
      dialogOrdinal,
    },
  ];
}

export function pruneDialogOrder(dialogOrder, messages) {
  const live = new Set(messages.map(resolveContextMessageDialogProcessId));
  return dialogOrder.filter((entry) => live.has(entry.dialogProcessId));
}
