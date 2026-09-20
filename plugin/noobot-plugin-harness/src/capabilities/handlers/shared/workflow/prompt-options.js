/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { isTextScenarioText } from "./matrix-resolver.js";

function resolveTextModeFromPromptSource(source = {}, data = {}) {
  return (
    source.textMode === true ||
    source.isTextMode === true ||
    data.textMode === true ||
    data.isTextMode === true ||
    isTextScenarioText(source.scenario) ||
    isTextScenarioText(source.scenarioKey) ||
    isTextScenarioText(source?.scenarioProfile?.key) ||
    isTextScenarioText(source?.scenarioProfile?.name) ||
    isTextScenarioText(data.scenario) ||
    isTextScenarioText(data.scenarioKey) ||
    isTextScenarioText(data?.scenarioProfile?.key) ||
    isTextScenarioText(data?.scenarioProfile?.name)
  );
}

export function normalizePromptOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  const programmingMode =
    source.programmingMode === true ||
    source.isProgrammingMode === true ||
    data.programmingMode === true;
  const textMode = !programmingMode && resolveTextModeFromPromptSource(source, data);
  return {
    locale: source.locale || LOCALE.ZH_CN,
    marker: String(source.marker || "").trim(),
    data,
    programmingMode,
    textMode,
    dynamicPolicyPrompt: String(
      source.dynamicPolicyPrompt || data.dynamicPolicyPrompt || "",
    ).trim(),
  };
}
