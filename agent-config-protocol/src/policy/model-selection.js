/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject } from "../utils.js";

export function readModelSelectionAlias(modelConfig = "") {
  if (typeof modelConfig === "string") return modelConfig.trim();
  if (!isPlainObject(modelConfig)) return "";
  return String(modelConfig.value || modelConfig.alias || modelConfig.key || modelConfig.model || "").trim();
}

export function selectModelAlias({ selectedModel = "", scenario = "", effectiveConfig = {} } = {}) {
  const requested = readModelSelectionAlias(selectedModel);
  if (requested) return Object.freeze({ alias: requested, source: "requested" });
  const scenarioKey = String(scenario || "").trim();
  const scenarioAlias = readModelSelectionAlias(effectiveConfig?.scenarios?.definitions?.[scenarioKey]?.model);
  if (scenarioAlias) return Object.freeze({ alias: scenarioAlias, source: "scenario" });
  const configured = readModelSelectionAlias(
    effectiveConfig?.defaultModelAlias || effectiveConfig?.defaultProvider,
  );
  return Object.freeze({ alias: configured, source: "configured_default" });
}
