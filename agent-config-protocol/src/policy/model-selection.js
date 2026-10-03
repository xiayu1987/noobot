/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const readAlias = (value) => (typeof value === "string" ? value.trim() : "");

export function selectModelAlias({ selectedModel = "", scenario = "", effectiveConfig = {} } = {}) {
  const requested = readAlias(selectedModel);
  if (requested) return Object.freeze({ alias: requested, source: "requested" });
  const scenarioKey = readAlias(scenario);
  const scenarioAlias = readAlias(effectiveConfig?.scenarios?.definitions?.[scenarioKey]?.model);
  if (scenarioAlias) return Object.freeze({ alias: scenarioAlias, source: "scenario" });
  return Object.freeze({
    alias: readAlias(effectiveConfig?.defaultProvider),
    source: "configured_default",
  });
}
