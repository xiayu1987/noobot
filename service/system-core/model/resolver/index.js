/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * High-level model spec resolution: default, by alias, by name, by skill.
 */
import {
  pickAlias,
  byAliasWithUser,
  firstEnabledAlias,
  getEnabledProviders,
} from "../provider/resolver.js";
import { normalizeModelSpecWithDefaults } from "../spec/normalizer.js";

/**
 * Resolve the default model spec from config chain.
 * @param {object} params
 * @returns {object|null}
 */
export function resolveDefaultModelSpec({ globalConfig, userConfig }) {
  const alias = pickAlias({ globalConfig, userConfig, skillConfig: {} });
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;
  const fallbackAlias = firstEnabledAlias(globalConfig, userConfig);
  if (!fallbackAlias) return null;
  return byAliasWithUser(fallbackAlias, globalConfig, userConfig);
}

/**
 * Resolve a model spec by alias from config chain.
 * @param {object} params
 * @returns {object|null}
 */
export function resolveModelSpecByAlias({
  alias,
  globalConfig,
  userConfig,
  fallbackToDefault = true,
}) {
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;
  if (!fallbackToDefault) return null;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

/**
 * Resolve a model spec by model name (searches all enabled providers).
 * @param {object} params
 * @returns {object|null}
 */
export function resolveModelSpecByName({
  name,
  modelName,
  globalConfig,
  userConfig,
  fallbackToDefault = true,
}) {
  const targetName = String(modelName || name || "").trim();
  if (!targetName) {
    if (!fallbackToDefault) return null;
    return resolveDefaultModelSpec({ globalConfig, userConfig });
  }

  const byAlias = resolveModelSpecByAlias({
    alias: targetName,
    globalConfig,
    userConfig,
    fallbackToDefault: false,
  });
  if (byAlias) return byAlias;

  const providers = getEnabledProviders(globalConfig, userConfig);
  for (const [alias, provider] of Object.entries(providers)) {
    const modelName = provider?.model || "";
    if (
      modelName.toLowerCase() === targetName.toLowerCase() ||
      alias.toLowerCase() === targetName.toLowerCase()
    ) {
      return normalizeModelSpecWithDefaults({ alias, ...provider });
    }
  }
  if (!fallbackToDefault) return null;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

/**
 * Resolve model spec with skill config override.
 * @param {object} params
 * @returns {object|null}
 */
export function resolveSkillModelSpec({
  skillConfig,
  globalConfig,
  userConfig,
}) {
  const alias = pickAlias({ globalConfig, userConfig, skillConfig });
  if (!alias) return resolveDefaultModelSpec({ globalConfig, userConfig });

  const spec = byAliasWithUser(alias, globalConfig, userConfig);
  if (!spec) return null;

  // skill-level overrides
  if (skillConfig.model) spec.model = skillConfig.model;
  if (skillConfig.temperature != null)
    spec.temperature = skillConfig.temperature;
  if (skillConfig.maxTokens != null) spec.maxTokens = skillConfig.maxTokens;
  if (skillConfig.topP != null) spec.topP = skillConfig.topP;
  if (skillConfig.frequencyPenalty != null)
    spec.frequencyPenalty = skillConfig.frequencyPenalty;
  if (skillConfig.presencePenalty != null)
    spec.presencePenalty = skillConfig.presencePenalty;

  return spec;
}
