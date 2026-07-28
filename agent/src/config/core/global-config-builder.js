/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { loadGlobalConfig } from "./global-config-loader.js";
import { normalizeKnownConfigKeys } from "./key-normalizer.js";
import { resolveConfigSecrets } from "./template-resolver.js";

function cloneConfig(value) {
  if (value === null || value === undefined) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeMigrationEntries(migrations = []) {
  return (Array.isArray(migrations) ? migrations : [])
    .map((entry, index) => {
      if (typeof entry === "function") {
        return {
          name: entry.name || `migration#${index + 1}`,
          migrate: entry,
        };
      }
      if (entry && typeof entry.migrate === "function") {
        return {
          name: String(entry.name || "").trim() || `migration#${index + 1}`,
          migrate: entry.migrate,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeValidatorEntries(validators = []) {
  return (Array.isArray(validators) ? validators : [])
    .map((entry, index) => {
      if (typeof entry === "function") {
        return {
          name: entry.name || `validator#${index + 1}`,
          validate: entry,
        };
      }
      if (entry && typeof entry.validate === "function") {
        return {
          name: String(entry.name || "").trim() || `validator#${index + 1}`,
          validate: entry.validate,
        };
      }
      return null;
    })
    .filter(Boolean);
}

export function createGlobalConfigBuilder({
  source = null,
  sourceName = "",
  migrations = [],
  validators = [],
  loadGlobalConfigFn = loadGlobalConfig,
  normalizeRawConfigFn = normalizeKnownConfigKeys,
  resolveConfigSecretsFn = resolveConfigSecrets,
  globalConfigPath = "",
  loadOptions = {},
} = {}) {
  let lastRawConfig = {};
  const normalizedMigrations = normalizeMigrationEntries(migrations);
  const normalizedValidators = normalizeValidatorEntries(validators);

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

  async function applyMigrations(rawConfig, context = {}) {
    let nextConfig = cloneConfig(rawConfig) || {};
    const appliedMigrations = [];
    for (const migration of normalizedMigrations) {
      const output = await migration.migrate({
        config: nextConfig,
        context,
      });
      if (output !== undefined) nextConfig = output;
      appliedMigrations.push(migration.name);
    }
    return {
      config: nextConfig,
      appliedMigrations,
    };
  }

  async function runValidators({ rawConfig, resolvedConfig, context = {} } = {}) {
    const warnings = [];
    for (const validator of normalizedValidators) {
      const result = await validator.validate({
        rawConfig,
        resolvedConfig,
        context,
      });
      if (result === false) {
        throw new Error(`[global-config-builder] validator failed: ${validator.name}`);
      }
      if (typeof result === "string" && String(result).trim()) {
        warnings.push(String(result).trim());
        continue;
      }
      if (result && typeof result === "object") {
        if (result.ok === false) {
          const detail = String(result.error || result.message || "").trim();
          throw new Error(
            detail
              ? `[global-config-builder] validator failed: ${validator.name} (${detail})`
              : `[global-config-builder] validator failed: ${validator.name}`,
          );
        }
        if (Array.isArray(result.warnings)) {
          warnings.push(
            ...result.warnings
              .map((warning) => String(warning || "").trim())
              .filter(Boolean),
          );
        }
      }
    }
    return warnings;
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
    const migrationResult = await applyMigrations(rawConfig, buildContext);
    const migratedRawConfig = migrationResult.config || {};
    const resolvedConfig = resolveConfigSecretsFn(migratedRawConfig, { configParams, env });
    resolvedConfig.configParams = { ...configParams };
    const warnings = await runValidators({
      rawConfig: migratedRawConfig,
      resolvedConfig,
      context: buildContext,
    });
    return {
      rawConfig: migratedRawConfig,
      resolvedConfig,
      configParams: { ...configParams },
      metadata: {
        source:
          String(sourceName || "").trim() ||
          (source && typeof source.name === "string" ? source.name : "") ||
          (typeof source === "function" ? source.name : "") ||
          "file",
        migrations: migrationResult.appliedMigrations,
        warnings,
      },
    };
  }

  return {
    loadRawConfig,
    build,
  };
}
