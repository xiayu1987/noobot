/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_SCENARIO_KEYS } from "./constants.js";
import { applyPrimaryModelReferencesToConfigFile } from "@noobot/agent-config-protocol";
import { listModelLibraryOptions, resolveModelLibraryProvider } from "@noobot/model-protocol";
import { deepClone, isPlainObject } from "./utils.js";

const TEMPLATE_VARIABLE_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

export function listConversationModelOptions() {
  return listModelLibraryOptions().filter(
    (option) => resolveModelLibraryProvider(option.key)?.used_for_conversation !== false,
  );
}

export function resolveLibraryModelKey(input = "") {
  const value = String(input || "").trim();
  if (!value) return "";
  const options = listConversationModelOptions();
  const byKey = options.find((option) => option.key === value);
  if (byKey) return byKey.key;
  const lowered = value.toLowerCase();
  const byModel = options.find((option) => String(option.model).toLowerCase() === lowered);
  return byModel ? byModel.key : "";
}

export function parseTemplateVariableName(templateValue = "") {
  const match = TEMPLATE_VARIABLE_PATTERN.exec(String(templateValue || "").trim());
  return match ? match[1] : "";
}

export function buildProviderFromTemplate({
  providerTemplate,
  forceConversationDefaults = false,
} = {}) {
  if (!isPlainObject(providerTemplate)) {
    throw new Error("provider template is required");
  }
  const baseProvider = deepClone(providerTemplate);
  baseProvider.enabled = true;
  baseProvider.used_for_conversation = true;

  if (forceConversationDefaults) {
    baseProvider.multimodal_parsing = {
      enabled: false,
    };
    baseProvider.multimodal_generation = {
      support_generation: {
        enabled: false,
        support_scope: [],
      },
    };
  }

  return baseProvider;
}

export function resolveProviderTemplate(providers = {}, providerAlias = "") {
  const sourceProviders = isPlainObject(providers) ? providers : {};
  const alias = String(providerAlias || "").trim();
  if (isPlainObject(sourceProviders[alias])) return sourceProviders[alias];
  return resolveModelLibraryProvider(alias);
}

export function normalizeBuiltinScenarioConfigForLauncher(
  scenarios = {},
  { programmingModel = "" } = {},
) {
  const source = isPlainObject(scenarios) ? scenarios : {};
  const defaultScenario = String(source.default || "full").trim();
  const definitions = isPlainObject(source.definitions) ? source.definitions : {};
  const programming = isPlainObject(definitions.programming) ? definitions.programming : {};
  const text = isPlainObject(definitions.text) ? definitions.text : {};
  const model = String(programmingModel || programming.model || "").trim();
  const textModel = String(programmingModel || text.model || "").trim();
  return {
    default: BUILTIN_SCENARIO_KEYS.has(defaultScenario) ? defaultScenario : "full",
    definitions: {
      programming: model ? { model } : {},
      text: textModel ? { model: textModel } : {},
    },
  };
}

export function alignInitialModelReferences({ globalConfig = {}, providerAlias = "" } = {}) {
  const alias = String(providerAlias || "").trim();
  if (!isPlainObject(globalConfig) || !alias) return globalConfig;

  globalConfig.scenarios = normalizeBuiltinScenarioConfigForLauncher(globalConfig.scenarios, {
    programmingModel: alias,
  });
  return applyPrimaryModelReferencesToConfigFile(globalConfig, alias);
}
