/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { loadGlobalConfig } from "./global-config-loader.js";
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
import { normalizeConfiguredModelProviders } from "./model-config-normalizer.js";

function cloneConfig(value) {
  if (value === null || value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export function createGlobalConfigBuilder({
  source = null,
  sourceName = "",
  migrations = [],
  validators = [],
  loadGlobalConfigFn = loadGlobalConfig,
  normalizeRawConfigFn = normalizeKnownConfigKeys,
  resolveConfigTemplatesFn = resolveConfigTemplates,
  globalConfigPath = "",
  loadOptions = {},
} = {}) {
  let lastRawConfig = {};
  const normalizedMigrations = normalizeConfigMigrations(migrations);
  const normalizedValidators = normalizeConfigValidators(validators);

  async function loadRawConfigBySource() {
    if (typeof source === "function") {
      return source({
        globalConfigPath,
        loadOptions,
      });
    }
    if (source && typeof source.loadRawConfig === "function") {
      return source.loadRawConfig({
        globalConfigPath,
        loadOptions,
      });
    }
    return loadGlobalConfigFn(globalConfigPath, loadOptions);
  }

  async function loadRawConfig({ reload = true } = {}) {
    if (!reload && lastRawConfig && Object.keys(lastRawConfig).length > 0) {
      return cloneConfig(lastRawConfig);
    }
    const sourceRawConfig = await loadRawConfigBySource();
    const normalizedRawConfig =
      typeof normalizeRawConfigFn === "function"
        ? normalizeRawConfigFn(sourceRawConfig || {})
        : sourceRawConfig || {};
    lastRawConfig = normalizedRawConfig || {};
    return cloneConfig(lastRawConfig);
  }

  async function build({
    configParams = {},
    reloadRawConfig = true,
    env = process.env,
    extraContext = {},
  } = {}) {
    const rawConfig = await loadRawConfig({ reload: reloadRawConfig });
    const buildContext = {
      env,
      configParams,
      extraContext: extraContext && typeof extraContext === "object" ? extraContext : {},
      globalConfigPath,
      loadOptions,
    };
    const migrationResult = await applyConfigMigrations({
      config: rawConfig,
      migrations: normalizedMigrations,
      context: buildContext,
    });
    const migratedRawConfig = normalizeConfiguredModelProviders(migrationResult.config || {});
    const resolvedConfig = resolveConfigTemplatesFn(migratedRawConfig, {
      lookup: createConfigValueLookup(configParams, env),
    });
    const warnings = await validateEffectiveConfig({
      rawConfig: migratedRawConfig,
      resolvedConfig,
      validators: normalizedValidators,
      context: buildContext,
    });
    return createConfigBuildResult({
      rawConfig: migratedRawConfig,
      resolvedConfig,
      metadata: {
        source:
          String(sourceName || "").trim() ||
          (source && typeof source.name === "string" ? source.name : "") ||
          (typeof source === "function" ? source.name : "") ||
          "file",
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
