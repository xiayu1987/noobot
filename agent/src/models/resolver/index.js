/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  pickAlias,
  byAliasWithUser,
  firstEnabledAlias,
  getEnabledProviders,
} from "../provider/resolver.js";
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";

export function resolveDefaultModelSpec({ globalConfig, userConfig }) {
  const alias = pickAlias({ globalConfig, userConfig, skillConfig: {} });
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;
  const fallbackAlias = firstEnabledAlias(globalConfig, userConfig);
  if (!fallbackAlias) return null;
  return byAliasWithUser(fallbackAlias, globalConfig, userConfig);
}

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
      return normalizeRuntimeModelSpec({ alias, ...provider });
    }
  }
  if (!fallbackToDefault) return null;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

export function resolveSkillModelSpec({ skillConfig, globalConfig, userConfig }) {
  const alias = pickAlias({ globalConfig, userConfig, skillConfig });
  if (!alias) return resolveDefaultModelSpec({ globalConfig, userConfig });

  const spec = byAliasWithUser(alias, globalConfig, userConfig);
  if (!spec) return null;

  // A skill may select another concrete model. Re-normalize after applying
  // the override so modelFamily, operator defaults, and concrete-model rules
  // are recalculated instead of leaking the alias model's identity.
  return normalizeRuntimeModelSpec({
    ...spec,
    ...(skillConfig.model ? { model: skillConfig.model } : {}),
    ...(skillConfig.temperature != null ? { temperature: skillConfig.temperature } : {}),
    ...(skillConfig.maxTokens != null ? { max_tokens: skillConfig.maxTokens } : {}),
    ...(skillConfig.topP != null ? { top_p: skillConfig.topP } : {}),
    ...(skillConfig.frequencyPenalty != null
      ? { frequency_penalty: skillConfig.frequencyPenalty }
      : {}),
    ...(skillConfig.presencePenalty != null
      ? { presence_penalty: skillConfig.presencePenalty }
      : {}),
  });
}
