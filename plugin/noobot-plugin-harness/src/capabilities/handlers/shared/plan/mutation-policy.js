/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeStage(stage = "") {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "planning_capture" || value === "capture" || value === "planning") {
    return "planning_capture";
  }
  if (value === "refinement") return "refinement";
  return "revision";
}

export function isSyntheticMainPlanPlaceholder(content = "") {
  const text = String(content || "").trim();
  if (!text) return false;
  return /^(\u4e3b\u8ba1\u5212|main plan)\s+\d+$/i.test(text);
}

export function resolvePlanMutationPolicy(stage = "", overrides = {}) {
  const normalizedStage = normalizeStage(stage);
  const base = {
    stage: normalizedStage,
    allowRevisionSubPatchCompatibility: true,
    allowRawAppendFallback: normalizedStage !== "planning_capture",
    rejectSyntheticMainPlaceholderCollapse: true,
  };
  return {
    ...base,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}
