/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FrontendRunState } from "./constants";

export function createInitialSessionRunState(overrides = {}) {
  return {
    state: FrontendRunState.IDLE,
    source: "initial",
    sourceEvent: "",
    updatedAtMs: 0,
    updatedAtIso: "",
    updatedAt: 0,
    lastEventType: "",
    ...overrides,
  };
}
