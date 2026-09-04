/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import {
  resolveModelLibraryProvider,
  resolveModelLibraryProviderByModel,
} from "@noobot/model-protocol";
import { isPlainObject } from "@noobot/agent-config-protocol";

export function normalizeConfiguredModelProviders(config = {}) {
  if (!isPlainObject(config.providers)) return config;
  const providers = Object.fromEntries(
    Object.entries(config.providers).map(([alias, provider]) => {
      const source = provider && typeof provider === "object" ? provider : {};
      const fallback =
        resolveModelLibraryProvider(alias) ||
        resolveModelLibraryProviderByModel(source.model) ||
        {};
      return [alias, normalizeRuntimeModelSpec({ alias, ...source }, fallback)];
    }),
  );
  return { ...config, providers };
}
