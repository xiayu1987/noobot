/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function normalizePlanMutationStage(stage = "") {
  const value = text(stage).toLowerCase();
  if (value === "planning_capture" || value === "capture" || value === "planning") {
    return "planning_capture";
  }
  if (value === "refinement") return "refinement";
  return "revision";
}
