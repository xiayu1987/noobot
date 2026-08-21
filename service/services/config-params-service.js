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
import {
  assertConfigParamsDocumentKeys,
  buildConfigParamCatalog as buildProtocolConfigParamCatalog,
  collectConfigTemplateKeys as scanConfigTemplateKeys,
  normalizeConfigParamsDocument,
} from "@noobot/agent-config-protocol";

const CONFIG_PARAMS_FILE_NAME = "config-params.json";

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
    return normalizeConfigParamsDocument(input);
  }

  function writeConfigReadFailedEvent({ event, filePath, error, data = {} } = {}) {
    void writeRoutedRuntimeEvent(
      {
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
      },
      runtimeEventsConfig,
    );
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
      if (error?.code !== "ENOENT") throw error;
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
      if (error?.code !== "ENOENT") throw error;
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
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }

  async function collectConfigTemplateKeys() {
    const globalConfigJson = typeof getGlobalConfigRaw === "function" ? getGlobalConfigRaw() : {};
    const templateBasePath =
      typeof templateRootPath === "function"
        ? templateRootPath()
        : path.resolve(process.cwd(), "../user-template/default-user");
    const templateConfigJson = await readConfigJsonIfExists(
      path.join(templateBasePath, "config.json"),
    );
    return scanConfigTemplateKeys(globalConfigJson, templateConfigJson);
  }

  async function collectUserConfigTemplateKeys(userId = "") {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return [];
    const userConfigFilePath = path.join(workspaceRootPath(), normalizedUserId, "config.json");
    const globalConfigJson = typeof getGlobalConfigRaw === "function" ? getGlobalConfigRaw() : {};
    const userConfigJson = await readConfigJsonIfExists(userConfigFilePath);
    return scanConfigTemplateKeys(globalConfigJson, userConfigJson);
  }

  async function collectConfigTemplateParamCatalog() {
    const payload = await readWorkspaceConfigParams({ createIfMissing: true });
    return buildProtocolConfigParamCatalog(payload);
  }

  function buildConfigParamCatalog({
    keys = undefined,
    descriptions = {},
    values = {},
    extraKeys = [],
  } = {}) {
    if (Array.isArray(keys)) {
      assertConfigParamsDocumentKeys(
        { values, descriptions },
        [...keys, ...(Array.isArray(extraKeys) ? extraKeys : [])],
      );
    }
    return buildProtocolConfigParamCatalog({
      keys: Array.isArray(keys) ? keys : [],
      descriptions,
      values,
      extraKeys,
    });
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
