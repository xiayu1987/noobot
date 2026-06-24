/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/

// Compatibility boundary for old workflow artifacts/runtime nodes.
// New code must write dialogProcessId; dialogId/nodeDialogId are read-only legacy aliases.
export function resolveWorkflowDialogProcessId(item = {}, ...fallbackItems) {
  const candidates = [item, ...fallbackItems];
  for (const candidate of candidates) {
    const value = String(
      candidate?.dialogProcessId || candidate?.nodeDialogProcessId || candidate?.dialogId || candidate?.nodeDialogId || "",
    ).trim();
    if (value) return value;
  }
  return "";
}

export function collectWorkflowDialogProcessIds(...items) {
  return items
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      return [item?.dialogProcessId, item?.nodeDialogProcessId, item?.dialogId, item?.nodeDialogId];
    })
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}
