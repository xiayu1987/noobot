/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeConfiguredModelProviders } from "./model-config-normalizer.js";
import {
  applyConfigMigrations,
  createConfigBuildResult,
  createConfigValueLookup,
  normalizeConfigMigrations,
  normalizeConfigValidators,
  normalizeKnownConfigKeys,
  resolveConfigTemplates,
  validateEffectiveConfig,
} from "@noobot/agent-config-protocol";
import { resolveConfiguredPathPolicy } from "./path-policy-adapter.js";
import { isFunction, isPlainObject } from "@noobot/shared/value";

function cloneConfig(value) {
  if (value === null || value === undefined) return value;
  return structuredClone(value);
}

function assertGlobalConfigSource(source) {
  const name = typeof source?.name === "string" ? source.name.trim() : "";
  if (!isFunction(source?.loadRawConfig) || !name) {
    throw new TypeError("global config source requires loadRawConfig() and name");
  }
  return name;
}

export function createGlobalConfigBuilder({ source, migrations = [], validators = [] } = {}) {
  const sourceName = assertGlobalConfigSource(source);
  let lastRawConfig = {};
  const normalizedMigrations = normalizeConfigMigrations(migrations);
  const normalizedValidators = normalizeConfigValidators(validators);

  async function loadRawConfig({ reload = true } = {}) {
    if (!reload && lastRawConfig && Object.keys(lastRawConfig).length > 0) {
      return cloneConfig(lastRawConfig);
    }
    const sourceRawConfig = await source.loadRawConfig();
    if (!isPlainObject(sourceRawConfig)) {
      throw new TypeError(`global config source ${sourceName} must return a plain object`);
    }
    lastRawConfig = normalizeKnownConfigKeys(sourceRawConfig);
    return cloneConfig(lastRawConfig);
  }

  async function build({ configParams = {}, reloadRawConfig = true, env = process.env } = {}) {
    const rawConfig = await loadRawConfig({ reload: reloadRawConfig });
    const buildContext = { env, configParams };
    const migrationResult = await applyConfigMigrations({
      config: rawConfig,
      migrations: normalizedMigrations,
      context: buildContext,
    });
    const persistedConfig = migrationResult.config || {};
    const migratedRawConfig = normalizeConfiguredModelProviders(persistedConfig);
    const resolvedConfig = resolveConfigTemplates(migratedRawConfig, {
      lookup: createConfigValueLookup(configParams, env),
    });
    resolveConfiguredPathPolicy(resolvedConfig);
    const warnings = await validateEffectiveConfig({
      rawConfig: migratedRawConfig,
      persistedConfig,
      resolvedConfig,
      validators: normalizedValidators,
      context: buildContext,
    });
    return createConfigBuildResult({
      rawConfig: migratedRawConfig,
      persistedConfig,
      resolvedConfig,
      metadata: {
        source: sourceName,
        migrations: migrationResult.appliedMigrations,
        warnings,
      },
    });
  }

  return {
    loadRawConfig,
    build,
  };
}
