/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_SCENARIO_KEYS } from "./constants.js";
import { deepClone, fileExists, hasOwnProperty, isPlainObject, readJsonStrict, writeJson } from "./utils.js";

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
        multimodal_generation: {
          support_understanding: false,
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
    baseProvider.multimodal_generation = {
      support_understanding: false,
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

  if (format === "openai_compatible" && !hasOwnProperty(baseProvider, "reasoning_effort")) {
    baseProvider.reasoning_effort = "low";
  }
  if (format === "openai_compatible" && !hasOwnProperty(baseProvider, "tool_reasoning_effort")) {
    baseProvider.tool_reasoning_effort = "low";
  }

  return baseProvider;
}

export function resolveTemplateProvider(providers = {}, format = "") {
  const sourceProviders = isPlainObject(providers) ? providers : {};
  const matchedProvider = Object.values(sourceProviders).find(
    (provider) => String(provider?.format || "").trim() === format,
  );
  if (isPlainObject(matchedProvider)) return matchedProvider;
  const firstProvider = Object.values(sourceProviders).find((provider) => isPlainObject(provider));
  return isPlainObject(firstProvider) ? firstProvider : null;
}

export function normalizeBuiltinScenarioConfigForLauncher(scenarios = {}, { programmingModel = "" } = {}) {
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

export function alignInitialModelReferences({
  globalConfig = {},
  providerAlias = "",
} = {}) {
  const alias = String(providerAlias || "").trim();
  if (!isPlainObject(globalConfig) || !alias) return globalConfig;

  if (isPlainObject(globalConfig.attachments)) {
    const attachmentModels = isPlainObject(globalConfig.attachments.attachment_models)
      ? { ...globalConfig.attachments.attachment_models }
      : null;
    if (attachmentModels) {
      for (const mediaTypeKey of ["audio", "video", "image"]) {
        if (hasOwnProperty(attachmentModels, mediaTypeKey)) {
          attachmentModels[mediaTypeKey] = alias;
        }
      }
      globalConfig.attachments = {
        ...globalConfig.attachments,
        attachment_models: attachmentModels,
      };
    }
  }

  if (isPlainObject(globalConfig.plugins) && isPlainObject(globalConfig.plugins.harness)) {
    const harness = { ...globalConfig.plugins.harness };
    if (isPlainObject(harness.stepModels)) {
      const nextStepModels = { ...harness.stepModels };
      for (const stepKey of Object.keys(nextStepModels)) {
        nextStepModels[stepKey] = alias;
      }
      harness.stepModels = nextStepModels;
    }
    if (isPlainObject(harness.capabilityModelByPurpose)) {
      const nextCapabilityMap = { ...harness.capabilityModelByPurpose };
      for (const purposeKey of Object.keys(nextCapabilityMap)) {
        nextCapabilityMap[purposeKey] = alias;
      }
      harness.capabilityModelByPurpose = nextCapabilityMap;
    }
    globalConfig.plugins = {
      ...globalConfig.plugins,
      harness,
    };
  }

  if (isPlainObject(globalConfig.plugins) && isPlainObject(globalConfig.plugins.workflow)) {
    globalConfig.plugins = {
      ...globalConfig.plugins,
      workflow: {
        ...globalConfig.plugins.workflow,
        semanticModel: alias,
      },
    };
  }

  if (isPlainObject(globalConfig.tools) && isPlainObject(globalConfig.tools.web_search)) {
    const webSearch = { ...globalConfig.tools.web_search };
    const responsesApi = isPlainObject(webSearch.responses_api)
      ? { ...webSearch.responses_api }
      : {};
    responsesApi.model = alias;
    webSearch.responses_api = responsesApi;
    globalConfig.tools = {
      ...globalConfig.tools,
      web_search: webSearch,
    };
  }

  globalConfig.scenarios = normalizeBuiltinScenarioConfigForLauncher(globalConfig.scenarios, {
    programmingModel: alias,
  });

  return globalConfig;
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
