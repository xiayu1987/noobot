/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_SCENARIO_KEYS } from "./constants.js";
import { applyPrimaryModelReferencesToConfigFile } from "@noobot/agent-config-protocol";
import { resolveModelLibraryProvider } from "@noobot/model-protocol";
import {
  deepClone,
  fileExists,
  hasOwnProperty,
  isPlainObject,
  readJsonStrict,
  writeJson,
} from "./utils.js";

export function normalizeProviderAlias(modelName = "") {
  const normalized = String(modelName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!normalized) return "custom_model";
  return /^[0-9]/.test(normalized) ? `model_${normalized}` : normalized;
}

export function resolveEnvNamesByFormat(format = "") {
  if (format === "dashscope") {
    return {
      apiKeyEnv: "DASHSCOPE_API_KEY",
      baseUrlEnv: "DASHSCOPE_API_ADDRESS",
    };
  }
  return {
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_API_ADDRESS",
  };
}

export function buildProviderFromTemplate({
  providerTemplate,
  format,
  modelName,
  apiKeyVar,
  baseUrlVar,
  forceConversationDefaults = false,
} = {}) {
  const baseProvider = isPlainObject(providerTemplate)
    ? deepClone(providerTemplate)
    : {
        enabled: true,
        used_for_conversation: true,
        temperature: 0.7,
        max_tokens: 10000,
        multimodal_parsing: {
          enabled: false,
        },
        multimodal_generation: {
          support_generation: {
            enabled: false,
            support_scope: [],
          },
        },
      };

  baseProvider.enabled = true;
  baseProvider.used_for_conversation = true;
  baseProvider.api_key = apiKeyVar;
  baseProvider.base_url = baseUrlVar;
  baseProvider.model = modelName;
  baseProvider.format = format;

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

  if (format === "dashscope") {
    if (!hasOwnProperty(baseProvider, "enable_thinking")) {
      baseProvider.enable_thinking = false;
    }
    if (!hasOwnProperty(baseProvider, "preserve_thinking")) {
      baseProvider.preserve_thinking = false;
    }
    if (!hasOwnProperty(baseProvider, "thinking_budget")) {
      baseProvider.thinking_budget = 0;
    }
    if (hasOwnProperty(baseProvider, "reasoning_effort")) {
      delete baseProvider.reasoning_effort;
    }
    if (hasOwnProperty(baseProvider, "tool_reasoning_effort")) {
      delete baseProvider.tool_reasoning_effort;
    }
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

export async function alignInitialModelReferencesForFile({
  filePath = "",
  providerAlias = "",
} = {}) {
  if (!filePath || !providerAlias) return;
  if (!(await fileExists(filePath))) return;
  const payload = await readJsonStrict(filePath, "config");
  if (!isPlainObject(payload)) return;
  const nextPayload = alignInitialModelReferences({
    globalConfig: deepClone(payload),
    providerAlias,
  });
  if (JSON.stringify(nextPayload) !== JSON.stringify(payload)) {
    await writeJson(filePath, nextPayload);
  }
}
