/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HOOK_PHASE_STATUS = Object.freeze({
  RUNNING: "running",
  SUCCESS: "success",
  ERROR: "error",
  ABORT: "abort",
});

export const HOOK_PHASE_STATUS_VALUES = Object.freeze(Object.values(HOOK_PHASE_STATUS));

const HOOK_PHASE_STATUS_SET = Object.freeze(new Set(HOOK_PHASE_STATUS_VALUES));

export function isHookPhaseStatus(value = "") {
  return HOOK_PHASE_STATUS_SET.has(String(value || "").trim());
}

export function normalizeHookPhaseStatus(value = "") {
  const status = String(value || "").trim();
  return HOOK_PHASE_STATUS_SET.has(status) ? status : "";
}
