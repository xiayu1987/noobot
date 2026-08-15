/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";
import { resolveModelLibraryProvider } from "@noobot/model-protocol";

export const MULTIMODAL_CONFIG_OPERATION = Object.freeze({
  PARSING: "parsing",
  GENERATION: "generation",
});

export const MULTIMODAL_CONFIG_MODALITY = Object.freeze({
  AUDIO: "audio",
  VIDEO: "video",
  IMAGE: "image",
  DOCUMENT: "document",
});

const OPERATIONS = new Set(Object.values(MULTIMODAL_CONFIG_OPERATION));
const MODALITIES = new Set(Object.values(MULTIMODAL_CONFIG_MODALITY));

function normalizeRequiredModalities(value = []) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  );
}

export function resolveMultimodalDefaultModelSelection(
  effectiveConfig = {},
  { operation = "", modalities = [] } = {},
) {
  const normalizedOperation = String(operation || "")
    .trim()
    .toLowerCase();
  if (!OPERATIONS.has(normalizedOperation)) {
    throw new TypeError(
      `unsupported multimodal config operation: ${normalizedOperation || "missing"}`,
    );
  }
  const requiredModalities = normalizeRequiredModalities(modalities);
  const invalidModalities = requiredModalities.filter((item) => !MODALITIES.has(item));
  if (invalidModalities.length) {
    throw new TypeError(`unsupported multimodal modalities: ${invalidModalities.join(", ")}`);
  }
  const operationConfig = effectiveConfig?.multimodal?.[normalizedOperation] || {};
  const defaultModels = isPlainObject(operationConfig?.defaultModels)
    ? operationConfig.defaultModels
    : {};
  const modelAliases = requiredModalities.map((modality) =>
    String(defaultModels?.[modality] || "").trim(),
  );
  const missingModalities = requiredModalities.filter((_, index) => !modelAliases[index]);
  const configuredAliases = Array.from(new Set(modelAliases.filter(Boolean)));
  return Object.freeze({
    operation: normalizedOperation,
    modalities: Object.freeze(requiredModalities),
    alias:
      missingModalities.length === 0 && configuredAliases.length === 1 ? configuredAliases[0] : "",
    configuredAliases: Object.freeze(configuredAliases),
    missingModalities: Object.freeze(missingModalities),
    conflicting: configuredAliases.length > 1,
  });
}

function setStringValues(target, value) {
  if (!isPlainObject(target)) return;
  for (const key of Object.keys(target)) {
    if (typeof target[key] === "string") target[key] = value;
  }
}

export function applyPrimaryModelReferencesToConfigFile(config = {}, modelAlias = "") {
  const alias = String(modelAlias || "").trim();
  if (!isPlainObject(config) || !alias) return config;
  const providers = isPlainObject(config.providers) ? config.providers : {};
  if (!isPlainObject(providers[alias])) {
    throw new TypeError(`selected model provider not found: ${alias}`);
  }

  config.default_provider = alias;
  providers[alias].enabled = true;
  providers[alias].used_for_conversation = true;

  const multimodal = isPlainObject(config.multimodal) ? config.multimodal : {};
  for (const operation of Object.values(MULTIMODAL_CONFIG_OPERATION)) {
    const operationConfig = isPlainObject(multimodal[operation]) ? multimodal[operation] : null;
    if (operationConfig) setStringValues(operationConfig.default_models, alias);
  }

  const scenarioDefinitions = config?.scenarios?.definitions;
  if (isPlainObject(scenarioDefinitions)) {
    for (const definition of Object.values(scenarioDefinitions)) {
      if (isPlainObject(definition) && Object.prototype.hasOwnProperty.call(definition, "model")) {
        definition.model = alias;
      }
    }
  }

  if (isPlainObject(config?.tools?.web_search?.responses_api)) {
    config.tools.web_search.responses_api.model = alias;
  }
  if (
    isPlainObject(config?.tools?.request_help) &&
    Object.prototype.hasOwnProperty.call(config.tools.request_help, "help_model")
  ) {
    config.tools.request_help.help_model = alias;
  }

  setStringValues(config?.plugins?.harness?.stepModels, alias);
  setStringValues(config?.plugins?.harness?.capabilityModelByPurpose, alias);
  if (
    isPlainObject(config?.plugins?.workflow) &&
    Object.prototype.hasOwnProperty.call(config.plugins.workflow, "semanticModel")
  ) {
    config.plugins.workflow.semanticModel = alias;
  }
  return config;
}

export function ensureModelProviderInConfigFile(
  config = {},
  modelAlias = "",
  { providerTemplate = null } = {},
) {
  const alias = String(modelAlias || "").trim();
  if (!isPlainObject(config)) throw new TypeError("config must be an object");
  if (!alias) throw new TypeError("model alias is required");
  if (!isPlainObject(config.providers)) config.providers = {};
  if (isPlainObject(config.providers[alias])) return config.providers[alias];

  const selectedTemplate = isPlainObject(providerTemplate)
    ? providerTemplate
    : resolveModelLibraryProvider(alias);
  if (!isPlainObject(selectedTemplate)) {
    throw new TypeError(`selected model provider not found: ${alias}`);
  }
  config.providers[alias] = JSON.parse(JSON.stringify(selectedTemplate));
  return config.providers[alias];
}
