/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { localizeBuiltinScenarios, resolveBuiltinScenarios } from "@noobot/agent-config-protocol";
import { tSystem } from "noobot-i18n/agent/system-text";

export function resolveLocalizedBuiltinScenarios(
  globalScenarios = {},
  userScenarios = {},
  { locale = "" } = {},
) {
  return localizeBuiltinScenarios(resolveBuiltinScenarios(globalScenarios, userScenarios), {
    locale,
    translate: tSystem,
  });
}
