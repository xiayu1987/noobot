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
    Object.entries(providers).filter(([, provider]) => isProviderEnabled(provider)),
  );
}

export function pickAlias({ globalConfig, userConfig, skillConfig }) {
  return (
    skillConfig?.provider || userConfig?.defaultProvider || globalConfig?.defaultProvider || ""
  );
}

export function byAliasWithUser(alias, globalConfig = {}, userConfig = {}) {
  return resolveEffectiveProvider(alias, mergeConfig(globalConfig, userConfig));
}

export function resolveEffectiveProvider(alias, effectiveConfig) {
  const providers = effectiveConfig.providers;
  if (!alias || !providers || !Object.hasOwn(providers, alias)) return null;
  const provider = providers[alias];
  if (!provider || !isProviderEnabled(provider)) return null;
  return normalizeRuntimeModelSpec({ alias, ...provider });
}

export function firstEnabledAlias(globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  const keys = Object.keys(providers);
  return keys.length ? keys[0] : "";
}
