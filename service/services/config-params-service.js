/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const CONFIG_PARAMS_FILE_NAME = "config-params.json";

function collectTemplateKeysFromObject(input, collector = new Set()) {
  if (typeof input === "string") {
    const templatePattern = /\$\{([A-Z0-9_]+)\}/g;
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

function normalizeConfigParamKey(input = "") {
  return String(input || "").trim().toUpperCase();
}

export function createConfigParamsService({
  workspaceRootPath,
  getGlobalConfigRaw,
  templateRootPath,
  runtimeEventsConfig,
} = {}) {
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
        .map(([key, value]) => [normalizeConfigParamKey(key), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key)),
    );
    const descriptions = Object.fromEntries(
      Object.entries(rawDescriptions)
        .map(([key, value]) => [normalizeConfigParamKey(key), String(value ?? "").trim()])
        .filter(([key]) => Boolean(key)),
    );
    return { values, descriptions };
  }

  function writeConfigReadFailedEvent({ event, filePath, error, data = {} } = {}) {
    void writeRoutedRuntimeEvent({
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.CONFIG,
      level: "warn",
      event,
      data: {
        fileName: path.basename(String(filePath || "")),
        filePathLength: String(filePath || "").length,
        ...data,
      },
      error,
    }, runtimeEventsConfig);
  }

  async function readWorkspaceConfigParams({ createIfMissing = false } = {}) {
    const filePath = workspaceConfigParamsFilePath();
    try {
      const parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
      return normalizeConfigParams(parsedPayload);
    } catch (error) {
      writeConfigReadFailedEvent({
        event: "service.configParams.workspace.read.failed",
        filePath,
        error,
        data: { createIfMissing: createIfMissing === true },
      });
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
    } catch (error) {
      writeConfigReadFailedEvent({
        event: "service.configParams.user.read.failed",
        filePath,
        error,
        data: {
          createIfMissing: createIfMissing === true,
          userIdLength: String(userId || "").trim().length,
        },
      });
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
    } catch (error) {
      writeConfigReadFailedEvent({
        event: "service.configParams.configJson.read.failed",
        filePath,
        error,
      });
      return {};
    }
  }

  async function collectConfigTemplateKeys() {
    const globalConfigJson =
      typeof getGlobalConfigRaw === "function" ? getGlobalConfigRaw() : {};
    const templateBasePath =
      typeof templateRootPath === "function"
        ? templateRootPath()
        : path.resolve(process.cwd(), "../user-template/default-user");
    const templateConfigJson = await readConfigJsonIfExists(
      path.join(templateBasePath, "config.json"),
    );
    const keys = new Set();
    collectTemplateKeysFromObject(globalConfigJson, keys);
    collectTemplateKeysFromObject(templateConfigJson, keys);
    return Array.from(keys).filter(Boolean).sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));
  }

  async function collectUserConfigTemplateKeys(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return [];
    const userConfigFilePath = path.join(workspaceRootPath(), normalizedUserId, "config.json");
    const globalConfigJson =
      typeof getGlobalConfigRaw === "function" ? getGlobalConfigRaw() : {};
    const userConfigJson = await readConfigJsonIfExists(userConfigFilePath);
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
