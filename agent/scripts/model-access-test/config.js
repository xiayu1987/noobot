/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createConfigValueLookup,
  mergeConfigParamLayers,
  normalizeConfigParamsDocument,
  resolveConfigTemplates,
  sanitizeUserConfig,
} from "@noobot/agent-config-protocol";
import { getEnabledProviders, resolveModelSpecByAlias } from "noobot-agent/model";
import { loadGlobalConfig } from "../../src/config/core/global-config-loader.js";

async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export async function loadTestModels({ configPath, workspaceRoot, userId = "admin" }) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error("Invalid user ID / 用户 ID 无效");
  const [rawGlobal, rawUser, workspaceParams, userParams] = await Promise.all([
    loadGlobalConfig(configPath),
    optionalJson(path.join(workspaceRoot, userId, "config.json")),
    optionalJson(path.join(workspaceRoot, "config-params.json")),
    optionalJson(path.join(workspaceRoot, userId, "config-params.json")),
  ]);
  const params = mergeConfigParamLayers(
    normalizeConfigParamsDocument(workspaceParams).values,
    normalizeConfigParamsDocument(userParams).values,
  );
  const lookup = createConfigValueLookup(params, process.env);
  const globalConfig = resolveConfigTemplates(rawGlobal, { lookup });
  const userConfig = sanitizeUserConfig(resolveConfigTemplates(rawUser, { lookup }));
  return Object.keys(getEnabledProviders(globalConfig, userConfig)).map((alias) =>
    resolveModelSpecByAlias({ alias, globalConfig, userConfig }),
  );
}

export function publicModelList(models) {
  return models.map((spec) => ({
    alias: spec.alias,
    model: spec.model,
    base_url: spec.base_url || "",
    adapterId: spec.adapterId,
    hasCredential: Boolean(spec.api_key && !spec.api_key.includes("${")),
  }));
}
