/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveMessageDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function isDialogAnchor(message = {}) {
  if (normalizeText(message?.role) !== "user") return false;
  if (message?.injectedMessage === true || message?.pluginMessage === true) return false;
  if (normalizeText(message?.injectedMessageType || message?.injected_message_type)) return false;
  return normalizeText(message?.messageOrigin).toLowerCase() !== "internal";
}

function compareLegacyAnchors(left, right) {
  const leftTime = Date.parse(left.startedAt);
  const rightTime = Date.parse(right.startedAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }
  return left.sourceIndex - right.sourceIndex;
}

export function deriveDialogOrderFromMessages(messages = []) {
  const source = Array.isArray(messages) ? messages : [];
  const anchorsByDialog = new Map();
  source.forEach((message, sourceIndex) => {
    if (!isDialogAnchor(message)) return;
    const dialogProcessId = resolveMessageDialogProcessId(message);
    if (!dialogProcessId || anchorsByDialog.has(dialogProcessId)) return;
    anchorsByDialog.set(dialogProcessId, {
      dialogProcessId,
      turnScopeId: normalizeText(message?.turnScopeId),
      userMessageUid: normalizeText(message?.messageUid),
      startedAt: normalizeText(message?.ts),
      sourceIndex,
    });
  });
  source.forEach((message, sourceIndex) => {
    const dialogProcessId = resolveMessageDialogProcessId(message);
    if (!dialogProcessId || anchorsByDialog.has(dialogProcessId)) return;
    anchorsByDialog.set(dialogProcessId, {
      dialogProcessId,
      turnScopeId: normalizeText(message?.turnScopeId),
      userMessageUid: "",
      startedAt: normalizeText(message?.ts),
      sourceIndex,
    });
  });
  return [...anchorsByDialog.values()]
    .sort(compareLegacyAnchors)
    .map(({ sourceIndex, ...entry }, index) => ({ ...entry, dialogOrdinal: index + 1 }));
}

export function normalizeDialogOrderEntity(dialogOrder = [], messages = []) {
  const derived = deriveDialogOrderFromMessages(messages);
  const liveDialogIds = new Set(derived.map((entry) => entry.dialogProcessId));
  const persisted = (Array.isArray(dialogOrder) ? dialogOrder : [])
    .map((entry = {}, index) => ({
      dialogProcessId: normalizeText(entry.dialogProcessId || entry.dialogId),
      turnScopeId: normalizeText(entry.turnScopeId),
      userMessageUid: normalizeText(entry.userMessageUid),
      startedAt: normalizeText(entry.startedAt),
      dialogOrdinal: Number.isInteger(Number(entry.dialogOrdinal ?? entry.sequence)) && Number(entry.dialogOrdinal ?? entry.sequence) > 0
        ? Number(entry.dialogOrdinal ?? entry.sequence)
        : index + 1,
    }))
    .filter((entry) => entry.dialogProcessId && liveDialogIds.has(entry.dialogProcessId));
  const persistedByDialog = new Map(persisted.map((entry) => [entry.dialogProcessId, entry]));
  const maxDialogOrdinal = persisted.reduce((max, entry) => Math.max(max, entry.dialogOrdinal), 0);
  let nextDialogOrdinal = maxDialogOrdinal + 1;
  const combined = [...persisted];
  for (const entry of derived) {
    const current = persistedByDialog.get(entry.dialogProcessId);
    if (current) {
      current.turnScopeId ||= entry.turnScopeId;
      current.userMessageUid ||= entry.userMessageUid;
      current.startedAt ||= entry.startedAt;
      continue;
    }
    combined.push({ ...entry, dialogOrdinal: nextDialogOrdinal++ });
  }
  return combined.sort((left, right) => left.dialogOrdinal - right.dialogOrdinal);
}

export function appendDialogOrderEntry(dialogOrder = [], message = {}) {
  const dialogProcessId = resolveMessageDialogProcessId(message);
  const source = Array.isArray(dialogOrder) ? dialogOrder : [];
  if (!dialogProcessId || source.some((entry) => entry?.dialogProcessId === dialogProcessId)) return source;
  const dialogOrdinal = source.reduce((max, entry) => Math.max(max, Number(entry?.dialogOrdinal) || 0), 0) + 1;
  return [...source, {
    dialogProcessId,
    turnScopeId: normalizeText(message?.turnScopeId),
    userMessageUid: normalizeText(message?.messageUid),
    startedAt: normalizeText(message?.ts),
    dialogOrdinal,
  }];
}
