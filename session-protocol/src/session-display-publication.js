/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isFunction, isPlainObject, text } from "@noobot/shared/value";
import { projectSessionMessageRecordIdentity } from "./aggregate/session-message-record.js";
import { messageRecordIdentityFieldsFor } from "./identity/message-identity-schema.js";
import { partitionJournalError } from "./errors.js";
import { messageReadJsonBytes } from "./message-read-budget.js";
import {
  encodeSessionDisplayOrderKey,
  readSessionDisplayOrderWindow,
  updateSessionDisplayOrder,
} from "./session-display-order-index.js";
import {
  applySessionDisplayRowDelta,
  createSessionDisplayStats,
  emptySessionDisplayRowCounts,
  requireSessionDisplayStats,
  sessionDisplayRowContribution,
} from "./session-display-page.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

const retainedMessageFields = new Set([
  "content",
  "contentReference",
  "contentBytes",
  "summarized",
  "pending",
  "ts",
  "role",
  "turnScopeId",
  "dialogProcessId",
  "parentDialogProcessId",
  ...["user", "assistant"].flatMap((role) => messageRecordIdentityFieldsFor(role).allowed),
]);

function requireDisplayRow(row) {
  if (!isPlainObject(row)) corrupt("Missing or invalid ranked display row");
  if (Object.hasOwn(row, "hasThinkingDetails"))
    corrupt("Published display row contains retained turn facts");
  if (row.turnPlaceholder !== true) {
    if (
      !text(row.messageUid) ||
      !Number.isSafeInteger(row.sessionOrdinal) ||
      row.sessionOrdinal < 1
    )
      corrupt("Invalid display message reference");
    if (Object.keys(row).some((field) => retainedMessageFields.has(field)))
      corrupt("Published display row contains retained message facts");
  }
  return row;
}

export function sessionDisplayMessageProjection({ content, summarized, pending, ...metadata }) {
  return metadata;
}

export function createSessionDisplayPublicationRow(row) {
  const { hasThinkingDetails, ...facts } = row;
  return row.turnPlaceholder === true
    ? facts
    : requireDisplayRow(
        Object.fromEntries(
          Object.entries(facts).filter(([field]) => !retainedMessageFields.has(field)),
        ),
      );
}

export function describeSessionDisplayMessageRow(
  row,
  { message, contentReference, contentBytes, hasThinkingDetails, thinkingContentTimeline },
) {
  requireDisplayRow(row);
  if (row.turnPlaceholder === true || row.messageUid !== message.messageUid)
    corrupt("Display message reference disagrees with its retained source");
  const withFacts = {
    ...row,
    ...projectSessionMessageRecordIdentity(message),
    role: message.role,
    turnScopeId: message.turnScopeId,
    dialogProcessId: message.dialogProcessId,
    ...(text(message.parentDialogProcessId)
      ? { parentDialogProcessId: text(message.parentDialogProcessId) }
      : {}),
    summarized: message.summarized === true,
    ...(hasThinkingDetails ? { hasThinkingDetails: true } : {}),
    ...(thinkingContentTimeline === undefined ? {} : { thinkingContentTimeline }),
    ...(message.pending === undefined ? {} : { pending: message.pending }),
    ...(text(message.ts) ? { ts: text(message.ts) } : {}),
    contentReference,
    contentBytes,
  };
  return { jsonBytes: messageReadJsonBytes(withFacts), read: () => withFacts };
}

async function readStatistics(store) {
  const value = await store.getStatistics();
  try {
    return requireSessionDisplayStats(value);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

function captureTransitions(changes) {
  if (!Array.isArray(changes))
    throw new TypeError("Display publication requires explicit row changes");
  const keys = new Set();
  return changes.map(({ order, existed, row }) => {
    const key = encodeSessionDisplayOrderKey(order);
    if (
      keys.has(key) ||
      typeof existed !== "boolean" ||
      (row === null ? !existed : !isPlainObject(row))
    )
      throw new TypeError("Invalid final display row transition");
    if (row !== null) requireDisplayRow(row);
    keys.add(key);
    return { key, order: [...order], before: existed, after: row !== null, row };
  });
}

export async function stageSessionDisplayPublication(
  store,
  { changes, sourceStatistics, countAttachments, artifactAttachmentDelta },
) {
  if (!Number.isSafeInteger(artifactAttachmentDelta))
    throw new TypeError("Display publication requires an integer artifact attachment delta");
  const rowFields = Object.keys(emptySessionDisplayRowCounts());
  if (!isPlainObject(sourceStatistics) || !isFunction(countAttachments))
    throw new TypeError(
      "Display publication requires explicit source statistics and attachment counting",
    );
  const { thinkingMessageCount, ...sourceCounts } = sourceStatistics;
  if ([...rowFields, "hasToolDetails"].some((field) => Object.hasOwn(sourceCounts, field)))
    throw new TypeError("Display publication derives final row statistics from row transitions");
  const edits = captureTransitions(changes);
  const previous = await readStatistics(store);
  let counts = Object.fromEntries(rowFields.map((field) => [field, previous[field]]));
  for (const { key, before, row } of edits) {
    const old = await store.getRow(key);
    if (before) {
      requireDisplayRow(old);
      const prior = sessionDisplayRowContribution(old, countAttachments(old));
      const retirement = Object.fromEntries(rowFields.map((field) => [field, -prior[field]]));
      counts = applySessionDisplayRowDelta(counts, retirement);
    } else if (old !== null) corrupt("Display row membership transition mismatch");
    if (row !== null)
      counts = applySessionDisplayRowDelta(
        counts,
        sessionDisplayRowContribution(row, countAttachments(row)),
      );
  }
  counts.attachmentCount += artifactAttachmentDelta;
  const next = createSessionDisplayStats({ ...sourceCounts, ...counts, thinkingMessageCount });
  if (edits.length === 0) {
    await readSessionDisplayOrderWindow(store.order.get, {
      count: previous.displayMessageCount,
      after: 0,
      length: 0,
    });
  }
  const count = await updateSessionDisplayOrder(store.order, previous.displayMessageCount, edits);
  if (count !== next.displayMessageCount) corrupt("Display order count does not match final rows");
  for (const { key, row } of edits) {
    if (row === null) store.removeRow(key);
    else store.setRow(key, row);
  }
  if (Object.keys(next).some((field) => next[field] !== previous[field])) store.setStatistics(next);
}

export async function readSessionDisplayPublicationWindow(store, { after, length }) {
  const stats = await readStatistics(store);
  const keys = await readSessionDisplayOrderWindow(store.order.get, {
    count: stats.displayMessageCount,
    after,
    length,
  });
  async function* readRows() {
    for (const key of keys) {
      const row = requireDisplayRow(await store.getRow(key));
      yield await store.describeRow(row, messageReadJsonBytes(row));
    }
  }
  return { stats, messages: readRows() };
}
