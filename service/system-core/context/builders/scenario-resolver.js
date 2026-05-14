/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeStringArray(input = []) {
  return Array.isArray(input)
    ? input
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    : [];
}

export function resolveScenarioProfile({ runConfig = {}, effectiveConfig = {} } = {}) {
  const runConfigProfile =
    runConfig?.scenarioProfile && typeof runConfig.scenarioProfile === "object"
      ? runConfig.scenarioProfile
      : {};
  const runConfigScenarioKey = String(runConfig?.scenario || "").trim();
  const scenarioConfig =
    effectiveConfig?.scenarios && typeof effectiveConfig.scenarios === "object"
      ? effectiveConfig.scenarios
      : {};
  const defaultScenarioKey = String(scenarioConfig?.default || "").trim();
  const resolvedScenarioKey = runConfigScenarioKey || defaultScenarioKey;
  const scenarioDefinitions =
    scenarioConfig?.definitions && typeof scenarioConfig.definitions === "object"
      ? scenarioConfig.definitions
      : {};
  const scenarioDefinition =
    resolvedScenarioKey &&
    scenarioDefinitions?.[resolvedScenarioKey] &&
    typeof scenarioDefinitions[resolvedScenarioKey] === "object"
      ? scenarioDefinitions[resolvedScenarioKey]
      : {};

  return {
    key: resolvedScenarioKey,
    name: String(runConfigProfile?.name || scenarioDefinition?.name || "").trim(),
    description: String(
      runConfigProfile?.description || scenarioDefinition?.description || "",
    ).trim(),
    model: String(runConfigProfile?.model || scenarioDefinition?.model || "").trim(),
    tools: normalizeStringArray(
      runConfigProfile?.tools ?? scenarioDefinition?.tools ?? [],
    ),
    context: normalizeStringArray(
      runConfigProfile?.context ?? scenarioDefinition?.context ?? [],
    ),
    services: normalizeStringArray(
      runConfigProfile?.services ?? scenarioDefinition?.services ?? [],
    ),
    mcpServers: normalizeStringArray(
      runConfigProfile?.mcpServers ??
        runConfigProfile?.mcp_servers ??
        scenarioDefinition?.mcpServers ??
        scenarioDefinition?.mcp_servers ??
        [],
    ),
  };
}
