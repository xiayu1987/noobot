/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeStatus(value = "") {
  const status = text(value).toLowerCase();
  if (status === "error") return "failed";
  if (status === "done" || status === "completed" || status === "succeeded") return "success";
  return status;
}

import { text, isObjectLike } from "@noobot/shared/value";

export function createStepStatusResolver() {
  return function resolveStepStatus(stepItem = {}) {
    const failure = stepItem?.stepFailure;
    if (isObjectLike(failure)) {
      if (text(failure?.message || failure?.error)) return "failed";
    } else if (text(failure)) {
      return "failed";
    }

    const explicit = normalizeStatus(stepItem?.status || stepItem?._status || "");
    if (explicit) return explicit;
    return "pending";
  };
}

export function resolveActionRuntimeStatus(actionNodeStates = [], resolveStepStatus) {
  const steps = [];
  for (const stateBox of Array.isArray(actionNodeStates) ? actionNodeStates : []) {
    for (const stepItem of Array.isArray(stateBox?.steps) ? stateBox.steps : [])
      steps.push(stepItem);
  }
  if (!steps.length) return "pending";

  const statuses = steps.map((stepItem) => resolveStepStatus(stepItem));
  if (statuses.some((status) => status === "running")) return "running";
  if (statuses.some((status) => status === "failed" || status === "error")) return "failed";
  if (statuses.every((status) => status === "success")) return "success";
  return "pending";
}
