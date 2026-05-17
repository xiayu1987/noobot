/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Provider resolution: merge, filter, alias selection.
 */
import { normalizeModelSpecWithDefaults } from "../spec/normalizer.js";

/**
 * Check if a provider configuration is enabled.
 * @param {object} provider - Provider config object.
 * @returns {boolean}
 */
export function isProviderEnabled(provider = {}) {
  return provider?.enabled !== false;
}

/**
 * Merge global and user provider configurations (user overrides global).
 * @param {object} globalConfig
 * @param {object} userConfig
 * @returns {object}
 */
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

/**
 * Get only enabled providers from merged config.
 * @param {object} globalConfig
 * @param {object} userConfig
 * @returns {object}
 */
export function getEnabledProviders(globalConfig = {}, userConfig = {}) {
  const providers = getProviders(globalConfig, userConfig);
  return Object.fromEntries(
    Object.entries(providers).filter(([, provider]) =>
      isProviderEnabled(provider),
    ),
  );
}

/**
 * Pick the best provider alias from config priority chain.
 * @param {object} params
 * @returns {string}
 */
export function pickAlias({ globalConfig, userConfig, skillConfig }) {
  return (
    skillConfig?.provider ||
    skillConfig?.model ||
    userConfig?.defaultProvider ||
    globalConfig?.defaultProvider ||
    ""
  );
}

/**
 * Resolve a normalized model spec by alias.
 * @param {string} alias
 * @param {object} globalConfig
 * @param {object} userConfig
 * @returns {object|null}
 */
export function byAliasWithUser(alias, globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  if (!alias || !providers[alias]) return null;
  return normalizeModelSpecWithDefaults({ alias, ...providers[alias] });
}

/**
 * Get the first enabled provider alias.
 * @param {object} globalConfig
 * @param {object} userConfig
 * @returns {string}
 */
export function firstEnabledAlias(globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  const keys = Object.keys(providers);
  return keys.length ? keys[0] : "";
}
