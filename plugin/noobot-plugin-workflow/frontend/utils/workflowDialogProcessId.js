/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveWorkflowDialogProcessId(item = {}) {
  return String(item?.dialogProcessId || "").trim();
}

export function collectWorkflowDialogProcessIds(...items) {
  return items
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      return [item?.dialogProcessId];
    })
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

export function summarizeWorkflowDialogProcessIdFields(item = {}) {
  return {
    dialogProcessId: String(item?.dialogProcessId || "").trim(),
    resolvedDialogProcessId: resolveWorkflowDialogProcessId(item),
  };
}
