/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { encodeBoundedJournalJson } from "./partition-journal-json.js";
import {
  mergeMessagePersistenceDeltas,
  projectMessagePersistenceEntries,
} from "./session-changes.js";

export const MESSAGE_WRITE_BUDGET_ERROR = "SESSION_MESSAGE_WRITE_BUDGET_EXCEEDED";
const encoder = new TextEncoder();

function measureDelta(delta, remainingBytes, exceeded) {
  try {
    const encoded = encodeBoundedJournalJson(delta, {
      budget: remainingBytes,
      maxDepth: 64,
      budgetError: exceeded,
    });
    return { bytes: encoder.encode(encoded).length };
  } catch (error) {
    if (error.code !== MESSAGE_WRITE_BUDGET_ERROR) throw error;
    return { error };
  }
}

export function selectMessagePersistenceBatch({
  entries,
  ownership,
  maxBytes = LENGTH_THRESHOLDS.sessionStorage.messageWriteBatchBytes,
  maxRecords = QUANTITY_THRESHOLDS.immutableStorage.messagePageSize,
}) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > LENGTH_THRESHOLDS.sessionStorage.messageWriteBatchBytes ||
    !Number.isSafeInteger(maxRecords) ||
    maxRecords < 1 ||
    maxRecords > QUANTITY_THRESHOLDS.immutableStorage.messagePageSize
  )
    throw new TypeError("Message persistence requires bounded byte and record limits");
  const selected = [];
  const deltas = [];
  let bytes = 0;
  const exceeded = () =>
    Object.assign(new Error("Message persistence delta exceeds the batch byte budget"), {
      code: MESSAGE_WRITE_BUDGET_ERROR,
      limit: maxBytes,
    });
  for (const { entry, delta } of projectMessagePersistenceEntries(entries, ownership)) {
    const measured = measureDelta(delta, maxBytes - bytes, exceeded);
    if (measured.error && !selected.length) throw measured.error;
    if (measured.error) break;
    bytes += measured.bytes;
    selected.push(entry);
    deltas.push(delta);
    if (selected.length === maxRecords) break;
  }
  return { entries: selected, changes: mergeMessagePersistenceDeltas(deltas), bytes };
}
