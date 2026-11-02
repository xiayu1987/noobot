/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHarnessBucket, assertHarnessState } from "../../src/core/bucket-contract.js";

export function createTestWorkflowState({ pending = {}, flags = {}, ...fields } = {}) {
  const { state } = createHarnessBucket();
  return assertHarnessState({
    ...state,
    ...fields,
    pending: { ...state.pending, ...pending },
    flags: { ...state.flags, planningCaptured: true, ...flags },
  });
}
