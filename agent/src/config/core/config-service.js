/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readFile } from "node:fs/promises";
import { filePath as path } from "@noobot/path-resolver";
import { recoverableToolError } from "../../shared/errors/index.js";
import {
  createConfigValueLookup,
  mergeConfigParamLayers,
  normalizeConfigParamsDocument,
  resolveConfigTemplates,
  sanitizeUserConfig,
} from "@noobot/agent-config-protocol";
import { ERROR_CODE } from "../../shared/errors/constants.js";

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseParamsDocument(rawText, documentName) {
  if (rawText === null) return {};
  try {
    return normalizeConfigParamsDocument(JSON.parse(rawText));
  } catch (error) {
    throw recoverableToolError(
      `${documentName} parse failed: ${error?.message || String(error)}`,
      { code: ERROR_CODE.RECOVERABLE_INVALID_USER_CONFIG },
    );
  }
}

export class ConfigService {
  constructor({ globalConfig = {} } = {}) {
    this.globalConfig = globalConfig;
  }

  async loadUserConfig(basePath) {
    const [rawText, workspaceConfigParamsRawText, userConfigParamsRawText] = await Promise.all([
      readFile(path.join(basePath, "config.json"), "utf8"),
      readOptionalText(path.join(basePath, "..", "config-params.json")),
      readOptionalText(path.join(basePath, "config-params.json")),
    ]);
    let raw = {};
    try {
      raw = JSON.parse(rawText);
    } catch (error) {
      throw recoverableToolError(`config.json parse failed: ${error?.message || String(error)}`, {
        code: ERROR_CODE.RECOVERABLE_INVALID_USER_CONFIG,
      });
    }

    const workspaceConfigParams = parseParamsDocument(
      workspaceConfigParamsRawText,
      "workspace config-params.json",
    );
    const userConfigParams = parseParamsDocument(userConfigParamsRawText, "user config-params.json");
    const systemConfigParams =
      this.globalConfig?.configParams && typeof this.globalConfig.configParams === "object"
        ? this.globalConfig.configParams
        : {};
    const mergedConfigParams = mergeConfigParamLayers(
      systemConfigParams,
      workspaceConfigParams,
      userConfigParams,
    );
    const resolvedRaw = resolveConfigTemplates(raw, {
      lookup: createConfigValueLookup(process.env, mergedConfigParams),
    });
    return sanitizeUserConfig(resolvedRaw);
  }
}
