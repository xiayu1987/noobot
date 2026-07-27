/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveWorkflowDialogProcessId(item = {}, ...fallbackItems) {
  const candidates = [item, ...fallbackItems];
  for (const candidate of candidates) {
    const value = String(
      candidate?.nodeDialogProcessId || candidate?.nodeDialogId || candidate?.dialogProcessId || candidate?.dialogId || "",
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

export function summarizeWorkflowDialogProcessIdFields(item = {}) {
  return {
    dialogProcessId: String(item?.dialogProcessId || "").trim(),
    nodeDialogProcessId: String(item?.nodeDialogProcessId || "").trim(),
    nodeDialogId: String(item?.nodeDialogId || "").trim(),
    dialogId: String(item?.dialogId || "").trim(),
    resolvedDialogProcessId: resolveWorkflowDialogProcessId(item),
  };
}
