/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDefaultModelSpec } from "../model/index.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeModelMultimodalInfo(modelSpec = {}) {
  const multimodalGeneration = isPlainObject(modelSpec?.multimodal_generation)
    ? modelSpec.multimodal_generation
    : {};
  const supportGeneration = isPlainObject(multimodalGeneration?.support_generation)
    ? multimodalGeneration.support_generation
    : {};
  const supportScope = Array.isArray(supportGeneration?.support_scope)
    ? supportGeneration.support_scope
        .map((scopeItem) => String(scopeItem || "").trim())
        .filter(Boolean)
    : [];
  return {
    support_understanding: multimodalGeneration?.support_understanding === true,
    support_generation: {
      enabled: supportGeneration?.enabled === true,
      support_scope: supportScope,
    },
  };
}

export function resolveModelSection({
  globalConfig = {},
  userConfig = {},
  effectiveConfig = {},
} = {}) {
  const currentModelSpec =
    resolveDefaultModelSpec({ globalConfig, userConfig }) || {};
  const providers = effectiveConfig?.providers || {};
  return {
    current: {
      alias: currentModelSpec?.alias || "",
      name: currentModelSpec?.model || "",
      description: currentModelSpec?.description || "",
      used_for_conversation:
        currentModelSpec?.used_for_conversation === undefined
          ? true
          : currentModelSpec?.used_for_conversation === true,
      multimodal_generation: normalizeModelMultimodalInfo(currentModelSpec),
    },
    available: Object.entries(providers)
      .filter(([, providerConfig]) => providerConfig?.enabled !== false)
      .map(([alias, providerConfig]) => ({
        alias,
        name: providerConfig?.model || "",
        description: providerConfig?.description || "",
        used_for_conversation:
          providerConfig?.used_for_conversation === undefined
            ? true
            : providerConfig?.used_for_conversation === true,
        multimodal_generation: normalizeModelMultimodalInfo(providerConfig),
      })),
  };
}

export function resolveAllEnabledProviders(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.fromEntries(
    Object.entries(providers).filter(([, cfg]) => cfg?.enabled !== false),
  );
}

