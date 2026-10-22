/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  pruneTurnSummaryCheckpoints,
  writeTurnSummaryCheckpoints,
} from "@noobot/context-protocol/policy/summary";
import {
  SESSION_ARTIFACT_WRITE_TIME_DIALOG_FACTS_SCHEMA_VERSION,
  deriveSessionAutoTitle,
  isDialogAnchorMessageRecord,
  resolveSessionMessageRecordDialogProcessId,
} from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";

function compareDialogAnchors(left, right) {
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

function collectDialogAnchors(messages) {
  const anchors = new Map();
  const addAnchor = (message, sourceIndex, anchored) => {
    const dialogProcessId = resolveSessionMessageRecordDialogProcessId(message);
    if (!dialogProcessId || anchors.has(dialogProcessId)) return;
    anchors.set(dialogProcessId, {
      dialogProcessId,
      turnScopeId: text(message?.turnScopeId),
      userMessageUid: anchored ? text(message?.messageUid) : "",
      startedAt: text(message?.ts),
      sourceIndex,
    });
  };
  messages.forEach((message, index) => {
    if (isDialogAnchorMessageRecord(message)) addAnchor(message, index, true);
  });
  messages.forEach((message, index) => addAnchor(message, index, false));
  return [...anchors.values()].sort(compareDialogAnchors);
}

function isPersistedDialogOrdinal(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function persistedDialogEntries(dialogOrder, liveDialogIds) {
  if (!Array.isArray(dialogOrder)) return [];
  const persisted = [];
  const seen = new Set();
  for (const entry of dialogOrder) {
    if (!isPlainObject(entry) || !isPersistedDialogOrdinal(entry.dialogOrdinal)) continue;
    const dialogProcessId = text(entry.dialogProcessId);
    if (!liveDialogIds.has(dialogProcessId) || seen.has(dialogProcessId)) continue;
    seen.add(dialogProcessId);
    persisted.push({
      dialogProcessId,
      turnScopeId: text(entry.turnScopeId),
      userMessageUid: text(entry.userMessageUid),
      startedAt: text(entry.startedAt),
      dialogOrdinal: entry.dialogOrdinal,
    });
  }
  return persisted;
}

export function deriveWriteTimeDialogOrder(dialogOrder, messages) {
  const anchors = collectDialogAnchors(messages);
  const persisted = persistedDialogEntries(
    dialogOrder,
    new Set(anchors.map((entry) => entry.dialogProcessId)),
  );
  const persistedByDialog = new Map(persisted.map((entry) => [entry.dialogProcessId, entry]));
  let nextDialogOrdinal = persisted.reduce((max, entry) => Math.max(max, entry.dialogOrdinal), 0);
  const combined = [...persisted];
  for (const { sourceIndex, ...anchor } of anchors) {
    const current = persistedByDialog.get(anchor.dialogProcessId);
    if (!current) {
      nextDialogOrdinal += 1;
      combined.push({ ...anchor, dialogOrdinal: nextDialogOrdinal });
      continue;
    }
    current.turnScopeId ||= anchor.turnScopeId;
    current.userMessageUid ||= anchor.userMessageUid;
    current.startedAt ||= anchor.startedAt;
  }
  return combined.sort((left, right) => left.dialogOrdinal - right.dialogOrdinal);
}

export function migrateWriteTimeDialogFacts(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_WRITE_TIME_DIALOG_FACTS_SCHEMA_VERSION)
    return;
  const { next } = context;
  const { messages } = next;
  next.dialogOrder = deriveWriteTimeDialogOrder(next.dialogOrder, messages);
  const autoTitle = deriveSessionAutoTitle(messages);
  if (autoTitle) next.autoTitle = autoTitle;
  else delete next.autoTitle;
  if ("turnSummaryCheckpoints" in next) {
    writeTurnSummaryCheckpoints(
      next,
      pruneTurnSummaryCheckpoints(next.turnSummaryCheckpoints, messages),
    );
  }
  context.changed = true;
  context.migrations.push("session-write-time-dialog-facts-v12");
}
