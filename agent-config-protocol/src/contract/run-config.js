/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { mergeConfig } from "../pipeline/effective-config.js";
import { isPlainObject, normalizeStringList } from "../utils.js";
import { removeDeniedToolNamesFromAllow } from "../policy/tool-policy.js";
import { text } from "@noobot/shared/value";
import { PREFERENCE_LANGUAGE } from "../enums.js";

export function requireRunLocale(runConfig) {
  if (!isPlainObject(runConfig) || !Object.values(PREFERENCE_LANGUAGE).includes(runConfig.locale)) {
    throw new TypeError("invalid_run_locale");
  }
  return runConfig.locale;
}

function createScenarioProfile(key, definition) {
  const tools = new Set(definition.tools);
  if (definition.services.length) tools.add("call_service");
  if (definition.mcpServers.length) tools.add("call_mcp_task");
  return {
    key,
    model: text(definition.model),
    tools: [...tools],
    context: [...definition.context],
    services: [...definition.services],
    mcpServers: [...definition.mcpServers],
  };
}

export class RunConfigResolver {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  mergeScenarioRestrictedList({ scenarioItems = [], currentItems = [], hasWildcard = false }) {
    if (!Array.isArray(scenarioItems) || !scenarioItems.length) return [];
    if (hasWildcard) return ["*"];
    if (!Array.isArray(currentItems) || !currentItems.length) {
      return [...scenarioItems];
    }
    const currentSet = new Set(currentItems);
    return scenarioItems.filter((name) => currentSet.has(name));
  }

  normalizeToolPolicyConflicts(toolPolicy = {}) {
    if (!isPlainObject(toolPolicy)) return toolPolicy;
    return removeDeniedToolNamesFromAllow({ toolPolicy });
  }

  normalizeRunConfigToolPolicyConflicts(runConfig = {}) {
    if (!isPlainObject(runConfig?.toolPolicy)) return runConfig;
    const nextToolPolicy = this.normalizeToolPolicyConflicts(runConfig.toolPolicy);
    if (nextToolPolicy === runConfig.toolPolicy) return runConfig;
    return {
      ...runConfig,
      toolPolicy: nextToolPolicy,
    };
  }

  resolveScenarioRunConfig(runConfig = {}, userConfig = {}) {
    const normalizedRunConfig = isPlainObject(runConfig) ? runConfig : {};
    const { scenarios: scenarioConfig } = mergeConfig(this.globalConfig, userConfig);
    const hasScenarioField = Object.prototype.hasOwnProperty.call(normalizedRunConfig, "scenario");
    const resolvedScenarioKey = String(
      hasScenarioField ? normalizedRunConfig?.scenario || "" : scenarioConfig?.default || "",
    ).trim();
    if (!resolvedScenarioKey) {
      return this.normalizeRunConfigToolPolicyConflicts(normalizedRunConfig);
    }
    if (!Object.hasOwn(scenarioConfig.definitions, resolvedScenarioKey)) {
      return this.normalizeRunConfigToolPolicyConflicts({
        ...normalizedRunConfig,
        scenario: resolvedScenarioKey,
      });
    }
    const scenarioProfile = createScenarioProfile(
      resolvedScenarioKey,
      scenarioConfig.definitions[resolvedScenarioKey],
    );
    const resolvedRunConfig = {
      ...normalizedRunConfig,
      scenario: resolvedScenarioKey,
      scenarioProfile,
    };
    const requestedRuntimeModel = text(normalizedRunConfig?.runtimeModel);
    if (requestedRuntimeModel) {
      resolvedRunConfig.runtimeModel = requestedRuntimeModel;
    }
    this.#applyScenarioToolPolicy(resolvedRunConfig, scenarioProfile.tools);
    this.#applyScenarioContextPolicy(resolvedRunConfig, scenarioProfile.context);
    return this.normalizeRunConfigToolPolicyConflicts(resolvedRunConfig);
  }

  #applyScenarioToolPolicy(resolvedRunConfig, scenarioToolNames) {
    const toolPolicyMode = text(resolvedRunConfig.toolPolicy?.mode).toLowerCase();
    if (
      scenarioToolNames.length &&
      !scenarioToolNames.includes("*") &&
      toolPolicyMode !== "custom_only"
    ) {
      const currentToolPolicy = isPlainObject(resolvedRunConfig.toolPolicy)
        ? resolvedRunConfig.toolPolicy
        : {};
      const currentAllowToolNames = normalizeStringList(currentToolPolicy?.allowToolNames);
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
  }

  #applyScenarioContextPolicy(resolvedRunConfig, scenarioContextKeys) {
    if (scenarioContextKeys.length) {
      const currentContextPolicy = isPlainObject(resolvedRunConfig.contextPolicy)
        ? resolvedRunConfig.contextPolicy
        : {};
      const currentContextKeys = normalizeStringList(currentContextPolicy?.promptSections);
      const mergedContextKeys = this.mergeScenarioRestrictedList({
        scenarioItems: scenarioContextKeys,
        currentItems: currentContextKeys,
        hasWildcard: scenarioContextKeys.includes("*"),
      });
      resolvedRunConfig.contextPolicy = {
        ...currentContextPolicy,
        promptSections: mergedContextKeys,
      };
    }
  }
}
