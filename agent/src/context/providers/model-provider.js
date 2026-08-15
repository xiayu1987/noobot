/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveDefaultModelSpec } from "../../models/index.js";
import { resolveModelMultimodalCapabilities } from "@noobot/model-protocol";

function normalizeModelMultimodalInfo(modelSpec = {}) {
  const generation = resolveModelMultimodalCapabilities(modelSpec).generation;
  return {
    support_generation: {
      enabled: generation.enabled,
      support_scope: [...generation.outputModalities],
      api_type: generation.apiType,
    },
  };
}

function normalizeModelMultimodalParsing(modelSpec = {}) {
  const parsing = resolveModelMultimodalCapabilities(modelSpec).parsing;
  return {
    enabled: parsing.enabled,
    input_modalities: [...parsing.inputModalities],
  };
}

export function resolveModelSection({
  globalConfig = {},
  userConfig = {},
  effectiveConfig = {},
} = {}) {
  const currentModelSpec = resolveDefaultModelSpec({ globalConfig, userConfig }) || {};
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
      multimodal_parsing: normalizeModelMultimodalParsing(currentModelSpec),
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
        multimodal_parsing: normalizeModelMultimodalParsing(providerConfig),
      })),
  };
}

export function resolveAllEnabledProviders(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.fromEntries(Object.entries(providers).filter(([, cfg]) => cfg?.enabled !== false));
}
