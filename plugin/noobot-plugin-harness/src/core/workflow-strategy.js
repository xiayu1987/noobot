/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "./workflow-params.js";

export function normalizeWorkflowStrategyName(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
  const modes = WORKFLOW_PARAMS.workflow.strategy.modes;
  if (
    normalized === modes.executionFirst ||
    normalized === "execution" ||
    normalized === "execute_first" ||
    normalized === "action_first"
  ) return modes.executionFirst;
  if (
    normalized === modes.riskFirst ||
    normalized === "risk" ||
    normalized === "safety_first"
  ) return modes.riskFirst;
  return "";
}

