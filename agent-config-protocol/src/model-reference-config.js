/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "./utils.js";
import { resolveModelLibraryProvider } from "@noobot/model-protocol";
import { MULTIMODAL_CONFIG_OPERATION } from "./multimodal-config.js";

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

  if (isPlainObject(config?.tools?.web_search?.model_web_search)) {
    config.tools.web_search.model_web_search.model = alias;
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
