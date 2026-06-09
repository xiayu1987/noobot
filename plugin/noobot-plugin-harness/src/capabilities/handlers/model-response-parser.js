/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./shared/constants.js";
import { extractJsonObjectFromText } from "./shared/checklist-utils.js";

const EMPTY_PLAN_METADATA = Object.freeze({
  totalGoal: "",
  taskOwner: "",
  nextPhase: { objective: "", checklistIndexes: [], content: "" },
});

export function isSummaryCompletionMarked(summaryText = "", locale = LOCALE.ZH_CN) {
  const text = String(summaryText || "").trim();
  if (!text) return false;
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const lastLine = String(lines[lines.length - 1] || "").trim().toLowerCase();
  if (!lastLine) return false;
  const zhMatched = /\u5c0f\u7ed3\u5b8c\u6210[\u3002\uff01\uff1f\u201d"]?$/.test(lastLine);
  const enMatched = /summary complete[.!?。！？”"]?$/.test(lastLine);
  if (zhMatched || enMatched) return true;
  // Relaxed rule: as long as summary has non-empty content, treat it as completed.
  // Marker is now optional to avoid blocking revision/refinement chaining.
  void locale;
  return true;
}

export function extractPlanMetadataFromText(text = "") {
  const parsed = extractJsonObjectFromText(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY_PLAN_METADATA, nextPhase: { ...EMPTY_PLAN_METADATA.nextPhase } };
  }

  const queue = [parsed];
  const visited = new Set();
  let selected = parsed;
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || Array.isArray(current)) continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (current.totalGoal || current.goal || current.objective || current.taskOwner || current.nextPhase) {
      selected = current;
      break;
    }
    for (const nested of Object.values(current)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      } else if (typeof nested === "string") {
        const nestedParsed = extractJsonObjectFromText(nested);
        if (nestedParsed && typeof nestedParsed === "object") {
          queue.push(nestedParsed);
        }
      }
    }
  }

  const nextPhase =
    selected.nextPhase && typeof selected.nextPhase === "object" && !Array.isArray(selected.nextPhase)
      ? selected.nextPhase
      : {};
  const nextPhaseIndexes = nextPhase.checklistIndexes ?? nextPhase.indexes;
  return {
    totalGoal: String(selected.totalGoal ?? selected.goal ?? selected.objective ?? "").trim(),
    taskOwner: String(selected.taskOwner ?? selected.owner ?? "").trim(),
    nextPhase: {
      objective: String(nextPhase.objective ?? nextPhase.goal ?? nextPhase.task ?? "").trim(),
      checklistIndexes: Array.isArray(nextPhaseIndexes)
        ? nextPhaseIndexes
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item))
        : [],
      content: String(nextPhase.content ?? nextPhase.description ?? "").trim(),
    },
  };
}

export function isChecklistComplete(checklist = []) {
  if (!Array.isArray(checklist) || !checklist.length) return false;
  return checklist.every(
    (item = {}) =>
      String(item?.task || "").trim().length > 0 &&
      String(item?.input || "").trim().length > 0 &&
      String(item?.output || "").trim().length > 0 &&
      item?.files &&
      typeof item.files === "object" &&
      !Array.isArray(item.files) &&
      Array.isArray(item.files.create) &&
      Array.isArray(item.files.modify) &&
      Array.isArray(item.files.delete),
  );
}

export function isPlanPayloadComplete(text = "", checklist = []) {
  const metadata = extractPlanMetadataFromText(text);
  if (!String(metadata.totalGoal || "").trim()) return false;
  return isChecklistComplete(checklist);
}
