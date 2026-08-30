/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import { mergeConfig } from "@noobot/agent-config-protocol";

export function isProviderEnabled(provider = {}) {
  return provider?.enabled !== false;
}

export function getProviders(globalConfig = {}, userConfig = {}) {
  return mergeConfig(globalConfig, userConfig).providers || {};
}

export function getEnabledProviders(globalConfig = {}, userConfig = {}) {
  const providers = getProviders(globalConfig, userConfig);
  return Object.fromEntries(
    Object.entries(providers).filter(([, provider]) => {
      if (!isProviderEnabled(provider)) return false;
      try {
        normalizeRuntimeModelSpec(provider);
        return true;
      } catch {
        return false;
      }
    }),
  );
}

export function pickAlias({ globalConfig, userConfig, skillConfig }) {
  return (
    skillConfig?.provider ||
    skillConfig?.model ||
    userConfig?.defaultProvider ||
    globalConfig?.defaultProvider ||
    ""
  );
}

export function byAliasWithUser(alias, globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  if (!alias || !providers[alias]) return null;
  return normalizeRuntimeModelSpec({ alias, ...providers[alias] });
}

export function firstEnabledAlias(globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  const keys = Object.keys(providers);
  return keys.length ? keys[0] : "";
}
