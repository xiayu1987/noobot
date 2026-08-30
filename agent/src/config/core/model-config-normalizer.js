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
      // Configuration repair owns persisted records. Runtime projection must
      // not let an obsolete record prevent the service from starting.
      continue;
    }
    try {
      providers[alias] = normalizeRuntimeModelSpec({ alias, ...provider });
    } catch {
      // A provider that cannot satisfy the current runtime model contract is
      // excluded from the runtime projection. The source configuration is
      // kept unchanged and will be repaired/persisted by the config-repair
      // pipeline when a canonical replacement exists.
    }
  }
  return { ...config, providers };
}
