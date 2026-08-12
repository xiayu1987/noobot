/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeConfiguredModelProviders(config = {}) {
  if (!isPlainObject(config.providers)) return config;
  const providers = {};
  for (const [alias, provider] of Object.entries(config.providers)) {
    if (!isPlainObject(provider)) {
      throw new TypeError(`configured model provider must be an object: ${alias}`);
    }
    try {
      providers[alias] = normalizeRuntimeModelSpec({ alias, ...provider });
    } catch (error) {
      throw new TypeError(
        `invalid configured model provider ${alias}: ${String(error?.message || error)}`,
        { cause: error },
      );
    }
  }
  return { ...config, providers };
}
