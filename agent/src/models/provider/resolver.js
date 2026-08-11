/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";

export function isProviderEnabled(provider = {}) {
  return provider?.enabled !== false;
}

export function getProviders(globalConfig = {}, userConfig = {}) {
  const globalProviders = globalConfig?.providers || {};
  const userProviders = userConfig?.providers || {};
  const merged = { ...globalProviders };
  for (const [alias, userProvider] of Object.entries(userProviders)) {
    merged[alias] = {
      ...(globalProviders[alias] || {}),
      ...(userProvider || {}),
    };
  }
  return merged;
}

export function getEnabledProviders(globalConfig = {}, userConfig = {}) {
  const providers = getProviders(globalConfig, userConfig);
  return Object.fromEntries(
    Object.entries(providers).filter(([, provider]) => isProviderEnabled(provider)),
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
