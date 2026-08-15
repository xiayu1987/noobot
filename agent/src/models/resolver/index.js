/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  pickAlias,
  byAliasWithUser,
  getEnabledProviders,
} from "../provider/resolver.js";
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";

export function resolveDefaultModelSpec({ globalConfig, userConfig }) {
  const alias = pickAlias({ globalConfig, userConfig, skillConfig: {} });
  return byAliasWithUser(alias, globalConfig, userConfig);
}

export function resolveModelSpecByAlias({
  alias,
  globalConfig,
  userConfig,
}) {
  return byAliasWithUser(alias, globalConfig, userConfig);
}

export function resolveModelSpecByName({
  name,
  modelName,
  globalConfig,
  userConfig,
}) {
  const targetName = String(modelName || name || "").trim();
  if (!targetName) return null;

  const byAlias = resolveModelSpecByAlias({
    alias: targetName,
    globalConfig,
    userConfig,
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
  return null;
}

export function resolveModelSpecOrConfiguredDefault({
  name,
  modelName,
  globalConfig,
  userConfig,
}) {
  const requestedModelSpec = resolveModelSpecByName({
    name,
    modelName,
    globalConfig,
    userConfig,
  });
  if (requestedModelSpec) return requestedModelSpec;
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
