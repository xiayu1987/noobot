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
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  buildConfigParamCatalog as buildProtocolConfigParamCatalog,
  collectConfigTemplateKeys as scanConfigTemplateKeys,
  normalizeConfigParamsDocument,
} from "@noobot/agent-config-protocol";
import { WORKSPACE_LAYOUT, WORKSPACE_ROOT_LAYOUT } from "@noobot/workspace-protocol/layout";
import { text } from "@noobot/shared/value";

export function createConfigParamsService({ workspaceRootPath, getGlobalConfigRaw } = {}) {
  function workspaceConfigParamsFilePath() {
    return path.join(workspaceRootPath(), WORKSPACE_ROOT_LAYOUT.CONFIG_PARAMS_FILE);
  }

  function userConfigParamsFilePath(userId = "") {
    const normalizedUserId = text(userId);
    return path.join(workspaceRootPath(), normalizedUserId, WORKSPACE_LAYOUT.CONFIG_PARAMS_FILE);
  }

  function normalizeConfigParams(input = {}) {
    return normalizeConfigParamsDocument(input);
  }

  function writeConfigReadFailedEvent({ event, filePath, error, data = {} } = {}) {
    void writeRuntimeEvent({
      scope: "system",
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
    });
  }

  async function readWorkspaceConfigParams({ createIfMissing = false } = {}) {
    const filePath = workspaceConfigParamsFilePath();
    try {
      const parsedPayload = JSON.parse(await readFile(filePath, "utf8"));
      return normalizeConfigParams(parsedPayload);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        writeConfigReadFailedEvent({
          event: "service.configParams.workspace.read.failed",
          filePath,
          error,
        });
        throw error;
      }
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
      if (error?.code !== "ENOENT") {
        writeConfigReadFailedEvent({
          event: "service.configParams.user.read.failed",
          filePath,
          error,
          data: { userIdLength: text(userId).length },
        });
        throw error;
      }
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

  async function readUserConfigJson(filePath = "") {
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      writeConfigReadFailedEvent({
        event: "service.configParams.configJson.read.failed",
        filePath,
        error,
      });
      throw error;
    }
  }

  async function collectConfigTemplateKeys() {
    return scanConfigTemplateKeys(getGlobalConfigRaw());
  }

  async function collectUserConfigTemplateKeys(userId = "") {
    const normalizedUserId = text(userId);
    if (!normalizedUserId) throw new TypeError("collectUserConfigTemplateKeys requires userId");
    const userConfigFilePath = path.join(
      workspaceRootPath(),
      normalizedUserId,
      WORKSPACE_LAYOUT.CONFIG_FILE,
    );
    const globalConfigJson = getGlobalConfigRaw();
    const userConfigJson = await readUserConfigJson(userConfigFilePath);
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
