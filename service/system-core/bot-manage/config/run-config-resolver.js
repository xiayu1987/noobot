/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mergeConfig } from "../../config/index.js";
import { isPlainObject } from "../../utils/shared-utils.js";

/**
 * Resolve scenario-based runtime config and apply tool policy scopes.
 */
export class RunConfigResolver {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  normalizeStringArray(input = []) {
    return Array.isArray(input)
      ? input
          .map((item) => (item ?? "").trim())
          .filter(Boolean)
      : [];
  }

  normalizeToolItems(input = []) {
    return Array.isArray(input)
      ? input.filter((item) => isPlainObject(item) && (item?.name ?? "").trim())
      : [];
  }

  applyRunConfigToolPolicy(agentContext = {}, runConfig = {}) {
    const sourceTools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];
    if (!sourceTools.length) return agentContext;
    const toolPolicy = runConfig?.toolPolicy || {};
    const mode = (toolPolicy?.mode ?? "").trim().toLowerCase();
    const customTools = this.normalizeToolItems(toolPolicy?.customTools);
    const configuredIncludeToolNames = this.normalizeStringArray(
      toolPolicy?.includeToolNames,
    );
    const includeToolNames = Array.from(
      new Set([
        ...configuredIncludeToolNames,
        ...(runConfig?.allowUserInteraction !== false &&
        runConfig?.toolPolicy?.forceIncludeUserInteraction !== false
          ? ["user_interaction"]
          : []),
      ]),
    );
    const includedTools = includeToolNames.length
      ? sourceTools.filter((toolItem) =>
          includeToolNames.includes(String(toolItem?.name || "")),
        )
      : [];

    let nextTools = sourceTools;
    if (mode === "custom_only") {
      nextTools = [...customTools, ...includedTools];
    } else if (mode === "append_custom" && customTools.length) {
      nextTools = [...sourceTools, ...customTools];
    }

    const allowToolNames = this.normalizeStringArray(toolPolicy?.allowToolNames);
    if (allowToolNames.length) {
      const allowSet = new Set(allowToolNames);
      nextTools = nextTools.filter((toolItem) =>
        allowSet.has(String(toolItem?.name || "")),
      );
    }

    const dedupedTools = [];
    const seenNames = new Set();
    for (const toolItem of nextTools) {
      const toolName = (toolItem?.name ?? "").trim();
      if (!toolName || seenNames.has(toolName)) continue;
      seenNames.add(toolName);
      dedupedTools.push(toolItem);
    }
    return {
      ...agentContext,
      payload: {
        ...(agentContext?.payload || {}),
        tools: {
          ...(agentContext?.payload?.tools || {}),
          registry: dedupedTools,
        },
      },
    };
  }

  mergeScenarioRestrictedList({
    scenarioItems = [],
    currentItems = [],
    hasWildcard = false,
  }) {
    if (!Array.isArray(scenarioItems) || !scenarioItems.length) return [];
    if (hasWildcard) return [];
    if (!Array.isArray(currentItems) || !currentItems.length) {
      return [...scenarioItems];
    }
    const currentSet = new Set(currentItems);
    return scenarioItems.filter((name) => currentSet.has(name));
  }

  resolveScenarioRunConfig(runConfig = {}, userConfig = {}) {
    const normalizedRunConfig = isPlainObject(runConfig) ? runConfig : {};
    const effectiveConfig = mergeConfig(
      this.globalConfig || {},
      isPlainObject(userConfig) ? userConfig : {},
    );
    const scenarioConfig = isPlainObject(effectiveConfig?.scenarios)
      ? effectiveConfig.scenarios
      : {};
    const hasScenarioField = Object.prototype.hasOwnProperty.call(
      normalizedRunConfig,
      "scenario",
    );
    const resolvedScenarioKey = String(
      hasScenarioField
        ? normalizedRunConfig?.scenario || ""
        : scenarioConfig?.default || "",
    ).trim();
    if (!resolvedScenarioKey) return normalizedRunConfig;
    const scenarioDefinitions = isPlainObject(scenarioConfig?.definitions)
      ? scenarioConfig.definitions
      : {};
    const scenarioDefinition = isPlainObject(
      scenarioDefinitions?.[resolvedScenarioKey],
    )
      ? scenarioDefinitions[resolvedScenarioKey]
      : null;
    if (!scenarioDefinition) {
      return {
        ...normalizedRunConfig,
        scenario: resolvedScenarioKey,
      };
    }
    const normalizeStringArray = (value = []) => this.normalizeStringArray(value);
    const scenarioToolNamesRaw = normalizeStringArray(scenarioDefinition?.tools);
    const scenarioServiceItems = normalizeStringArray(scenarioDefinition?.services);
    const scenarioMcpServerItems = normalizeStringArray(
      scenarioDefinition?.mcpServers ?? scenarioDefinition?.mcp_servers,
    );
    const scenarioToolNameSet = new Set(scenarioToolNamesRaw);
    if (scenarioServiceItems.length) {
      scenarioToolNameSet.add("call_service");
    }
    if (scenarioMcpServerItems.length) {
      scenarioToolNameSet.add("call_mcp_task");
    }
    const scenarioToolNames = Array.from(scenarioToolNameSet);
    const scenarioContextKeys = normalizeStringArray(scenarioDefinition?.context);
    const hasAllTools = scenarioToolNames.includes("*");
    const hasAllContext = scenarioContextKeys.includes("*");
    const scenarioName = (scenarioDefinition?.name ?? "").trim();
    const scenarioDescription = (scenarioDefinition?.description ?? "").trim();
    const scenarioModelName = (scenarioDefinition?.model ?? "").trim();
    const resolvedRunConfig = {
      ...normalizedRunConfig,
      scenario: resolvedScenarioKey,
      scenarioProfile: {
        key: resolvedScenarioKey,
        name: scenarioName,
        description: scenarioDescription,
        model: scenarioModelName,
        tools: scenarioToolNames,
        context: scenarioContextKeys,
        services: scenarioServiceItems,
        mcpServers: scenarioMcpServerItems,
      },
    };
    const requestedRuntimeModel = String(
      normalizedRunConfig?.runtimeModel || "",
    ).trim();
    if (!requestedRuntimeModel && scenarioModelName) {
      resolvedRunConfig.runtimeModel = scenarioModelName;
    }
    if (scenarioToolNames.length && !hasAllTools) {
      const currentToolPolicy = isPlainObject(normalizedRunConfig?.toolPolicy)
        ? normalizedRunConfig.toolPolicy
        : {};
      const currentAllowToolNames = normalizeStringArray(
        currentToolPolicy?.allowToolNames,
      );
      const mergedAllowToolNames = this.mergeScenarioRestrictedList({
        scenarioItems: scenarioToolNames,
        currentItems: currentAllowToolNames,
      });
      resolvedRunConfig.toolPolicy = {
        ...currentToolPolicy,
        allowToolNames: mergedAllowToolNames,
        forceIncludeUserInteraction: false,
      };
    }
    if (scenarioContextKeys.length) {
      const currentContextPolicy = isPlainObject(normalizedRunConfig?.contextPolicy)
        ? normalizedRunConfig.contextPolicy
        : {};
      const currentContextKeys = normalizeStringArray(
        currentContextPolicy?.includeContextKeys,
      );
      const mergedContextKeys = this.mergeScenarioRestrictedList({
        scenarioItems: scenarioContextKeys,
        currentItems: currentContextKeys,
        hasWildcard: hasAllContext,
      });
      resolvedRunConfig.contextPolicy = {
        ...currentContextPolicy,
        includeContextKeys: mergedContextKeys,
      };
    }
    return resolvedRunConfig;
  }
}
