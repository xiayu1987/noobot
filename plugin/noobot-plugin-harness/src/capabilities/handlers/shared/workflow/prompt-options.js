/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { resolveHarnessScenarioFromOptions } from "./matrix-resolver.js";
import { text } from "@noobot/shared/value";

export function normalizePromptOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  return {
    locale: source.locale || LOCALE.ZH_CN,
    marker: text(source.marker),
    data,
    scenario: resolveHarnessScenarioFromOptions(source),
    dynamicPolicyPrompt: text(source.dynamicPolicyPrompt),
  };
}
