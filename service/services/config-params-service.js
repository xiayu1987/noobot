/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIG_PARAMS_FILE_NAME = "config-params.json";

function collectTemplateKeysFromObject(input, collector = new Set()) {
  if (typeof input === "string") {
    const templatePattern = /\$\{([A-Z0-9_]+)\}/gi;
    let matchedItem = templatePattern.exec(input);
    while (matchedItem) {
      collector.add(String(matchedItem[1] || "").trim());
      matchedItem = templatePattern.exec(input);
    }
    return collector;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectTemplateKeysFromObject(item, collector);
    return collector;
  }
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) {
      collectTemplateKeysFromObject(value, collector);
    }
  }
  return collector;
}

export function createConfigParamsService({ workspaceRootPath, globalConfigRaw } = {}) {
  function workspaceConfigParamsFilePath() {
    return path.join(workspaceRootPath(), CONFIG_PARAMS_FILE_NAME);
  }

  function userConfigParamsFilePath(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    return path.join(workspaceRootPath(), normalizedUserId, CONFIG_PARAMS_FILE_NAME);
  }

  function normalizeConfigParams(input = {}) {
    const rawValues = input?.values && typeof input.values === "object" ? input.values : {};
    const rawDescriptions =
      input?.descriptions && typeof input.descriptions === "object"
        ? input.descriptions
        : {};
    const values = Object.fromEntries(
      Object.entries(rawValues)
        .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key)),
    );
    const descriptions = Object.fromEntries(
      Object.entries(rawDescriptions)
        .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key)),
    );
    return { values, descriptions };
  }

  async function readWorkspaceConfigParams({ createIfMissing = false } = {}) {
    const filePath = workspaceConfigParamsFilePath();
    try {
      const parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
      return normalizeConfigParams(parsedPayload);
    } catch {
      if (!createIfMissing) return normalizeConfigParams({});
      const payload = normalizeConfigParams({});
      await writeWorkspaceConfigParams(payload);
      return payload;
    }
  }

  async function writeWorkspaceConfigParams(input = {}) {
    const payload = normalizeConfigParams(input);
    const filePath = workspaceConfigParamsFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async function readUserConfigParams({ userId = "", createIfMissing = false } = {}) {
    const filePath = userConfigParamsFilePath(userId);
    try {
      const parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
      return normalizeConfigParams(parsedPayload);
    } catch {
      if (!createIfMissing) return normalizeConfigParams({});
      const payload = normalizeConfigParams({});
      await writeUserConfigParams({ userId, input: payload });
      return payload;
    }
  }

  async function writeUserConfigParams({ userId = "", input = {} } = {}) {
    const payload = normalizeConfigParams(input);
    const filePath = userConfigParamsFilePath(userId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  }

  async function readConfigJsonIfExists(filePath = "") {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      return {};
    }
  }

  async function collectConfigTemplateKeys() {
    const globalConfigFilePath = path.resolve(process.cwd(), "./config/global.config.json");
    const templateConfigFilePath = path.resolve(
      process.cwd(),
      String(globalConfigRaw?.workspaceTemplatePath || "../user-template/default-user"),
      "config.json",
    );
    const [globalConfigJson, templateConfigJson] = await Promise.all([
      readConfigJsonIfExists(globalConfigFilePath),
      readConfigJsonIfExists(templateConfigFilePath),
    ]);
    const keys = new Set();
    collectTemplateKeysFromObject(globalConfigJson, keys);
    collectTemplateKeysFromObject(templateConfigJson, keys);
    return Array.from(keys).filter(Boolean).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
  }

  async function collectUserConfigTemplateKeys(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return [];
    const userConfigFilePath = path.join(workspaceRootPath(), normalizedUserId, "config.json");
    const [globalConfigJson, userConfigJson] = await Promise.all([
      readConfigJsonIfExists(path.resolve(process.cwd(), "./config/global.config.json")),
      readConfigJsonIfExists(userConfigFilePath),
    ]);
    const keys = new Set();
    collectTemplateKeysFromObject(globalConfigJson, keys);
    collectTemplateKeysFromObject(userConfigJson, keys);
    return Array.from(keys).filter(Boolean).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
  }

  async function collectConfigTemplateParamCatalog() {
    const payload = await readWorkspaceConfigParams({ createIfMissing: true });
    const allKeys = Object.keys(payload?.values || {})
      .concat(Object.keys(payload?.descriptions || {}))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const dedupedKeys = Array.from(new Set(allKeys)).sort((leftKey, rightKey) =>
      leftKey.localeCompare(rightKey),
    );
    const descriptionMap = payload?.descriptions || {};
    return dedupedKeys.map((key) => ({
      key,
      description: String(descriptionMap?.[key] || "").trim(),
    }));
  }

  function buildConfigParamCatalog({
    keys = [],
    descriptions = {},
    values = {},
    extraKeys = [],
  } = {}) {
    const mergedKeys = Array.from(
      new Set(
        [
          ...(Array.isArray(keys) ? keys : []),
          ...Object.keys(descriptions || {}),
          ...Object.keys(values || {}),
          ...(Array.isArray(extraKeys) ? extraKeys : []),
        ]
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    ).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
    return mergedKeys.map((key) => ({
      key,
      description: String(descriptions?.[key] || "").trim(),
    }));
  }

  return {
    normalizeConfigParams,
    readWorkspaceConfigParams,
    writeWorkspaceConfigParams,
    readUserConfigParams,
    writeUserConfigParams,
    collectConfigTemplateKeys,
    collectUserConfigTemplateKeys,
    collectConfigTemplateParamCatalog,
    buildConfigParamCatalog,
  };
}
