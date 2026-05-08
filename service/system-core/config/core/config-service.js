/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { recoverableToolError } from "../../error/index.js";
import { resolveConfigSecrets } from "./template-resolver.js";
import { sanitizeUserConfig } from "./user-override-policy.js";

function normalizeConfigParams(input = {}) {
  const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
  return Object.fromEntries(
    Object.entries(rawValues)
      .map(([paramKey, paramValue]) => [
        String(paramKey || "").trim(),
        String(paramValue ?? "").trim(),
      ])
      .filter(([paramKey]) => Boolean(paramKey)),
  );
}

function mergeConfigParamsWithFallback(systemParams = {}, userParams = {}) {
  const base = {
    ...(systemParams && typeof systemParams === "object" ? systemParams : {}),
  };
  const userSource = userParams && typeof userParams === "object" ? userParams : {};
  for (const [paramKey, rawValue] of Object.entries(userSource)) {
    const normalizedKey = String(paramKey || "").trim();
    if (!normalizedKey) continue;
    const normalizedValue = String(rawValue ?? "").trim();
    if (!normalizedValue) continue;
    base[normalizedKey] = normalizedValue;
  }
  return base;
}

export class ConfigService {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  async loadUserConfig(basePath) {
    const [rawText, userConfigParamsRawText] = await Promise.all([
      readFile(path.join(basePath, "config.json"), "utf8"),
      readFile(path.join(basePath, "config-params.json"), "utf8").catch(() => "{}"),
    ]);
    let raw = {};
    try {
      raw = JSON.parse(rawText);
    } catch (error) {
      throw recoverableToolError(
        `config.json parse failed: ${error?.message || String(error)}`,
        {
          code: "RECOVERABLE_INVALID_USER_CONFIG",
        },
      );
    }

    let userConfigParamsJson = {};
    try {
      userConfigParamsJson = JSON.parse(String(userConfigParamsRawText || "{}"));
    } catch {
      userConfigParamsJson = {};
    }
    const userConfigParams = normalizeConfigParams(userConfigParamsJson);
    const systemConfigParams =
      this.globalConfig?.configParams && typeof this.globalConfig.configParams === "object"
        ? this.globalConfig.configParams
        : {};
    const mergedConfigParams = mergeConfigParamsWithFallback(
      systemConfigParams,
      userConfigParams,
    );
    const resolvedRaw = resolveConfigSecrets(raw, {
      configParams: mergedConfigParams,
    });
    const sanitized = sanitizeUserConfig(resolvedRaw);
    return {
      ...sanitized,
      configParams: mergedConfigParams,
    };
  }
}
