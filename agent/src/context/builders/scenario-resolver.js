/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveLocalizedScenarioProfile } from "../../config/core/scenario-localization-adapter.js";

export function resolveScenarioProfile({ runConfig = {} } = {}) {
  return resolveLocalizedScenarioProfile(runConfig?.scenarioProfile, {
    locale: runConfig?.locale,
  });
}
