/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logWarn } from "../tracking/console/logger.js";

const warnedFieldSet = new Set();
const fieldHitCountMap = new Map();

export function warnAgentContextCompatFieldOnce({
  field = "",
  replacement = "",
  note = "",
} = {}) {
  const normalizedField = String(field || "").trim();
  if (!normalizedField) return;
  fieldHitCountMap.set(normalizedField, (fieldHitCountMap.get(normalizedField) || 0) + 1);
  const dedupeKey = `${normalizedField}=>${String(replacement || "").trim()}`;
  if (warnedFieldSet.has(dedupeKey)) return;
  warnedFieldSet.add(dedupeKey);
  const replacementText = String(replacement || "").trim();
  const noteText = String(note || "").trim();
  logWarn(
    `[agent-context][deprecated] ${normalizedField} is deprecated` +
      (replacementText ? `, use ${replacementText} instead` : "") +
      (noteText ? ` (${noteText})` : ""),
  );
}

export function getAgentContextCompatFieldHitStats() {
  const output = {};
  for (const [field, count] of fieldHitCountMap.entries()) {
    output[field] = count;
  }
  return output;
}

export function resetAgentContextCompatFieldHitStats() {
  fieldHitCountMap.clear();
  warnedFieldSet.clear();
}
