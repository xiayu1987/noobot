/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createRunPreferences } from "@noobot/agent-transport-protocol/run-preferences";

const {
  allowUserInteraction,
  safeConfirm,
  sanitizeOutput,
  streaming,
  frontendThresholdsEnabled,
  safeConfirmLevel,
} = createRunPreferences({});

export const TEST_RUN_PREFERENCES = Object.freeze({
  allowUserInteraction,
  safeConfirm,
  sanitizeOutput,
  streaming,
  frontendThresholdsEnabled,
  safeConfirmLevel,
});
