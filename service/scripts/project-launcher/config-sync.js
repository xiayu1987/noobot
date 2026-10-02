/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  collectConfigTemplateKeys,
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_REPAIR_ACTION,
  normalizeConfigParamKey,
  normalizeConfigParamValues,
  normalizeConfigParamsDocument,
  repairConfigDocument,
  summarizeConfigRepairReport,
} from "@noobot/agent-config-protocol";
import { localizeConfigTextTree, resolveTextLocaleFromConfigLanguage, t } from "./i18n.js";
import { alignInitialModelReferences } from "./provider.js";
import {
  deepClone,
  fileExists,
  hasOwnProperty,
  isPlainObject,
  readJsonRelaxed,
  readJsonWithInvalidBackup,
  writeJson,
} from "./utils.js";

export async function ensureModelProxyConfig({ serviceRoot } = {}) {
  const modelProxyRoot = path.resolve(serviceRoot, "../model-proxy");
  const examplePath = path.join(modelProxyRoot, "model-proxy.config.example.json");
  const configPath = path.join(modelProxyRoot, "model-proxy.config.json");

  if (await fileExists(configPath)) return;
  if (!(await fileExists(examplePath))) return;

  await copyFile(examplePath, configPath);
}

export async function ensureAgentProxyConfig({ serviceRoot } = {}) {
  const agentProxyRoot = path.resolve(serviceRoot, "../agent-proxy");
  const examplePath = path.join(agentProxyRoot, "agent-proxy.config.example.json");
  const configPath = path.join(agentProxyRoot, "agent-proxy.config.json");

  if (await fileExists(configPath)) return;
  if (!(await fileExists(examplePath))) return;

  await copyFile(examplePath, configPath);
}

export async function upsertConfigParams({
  workspaceRootAbsolutePath,
  configParamsFilePath = "",
  entries = {},
  overwriteKeys = [],
} = {}) {
  const filePath =
    String(configParamsFilePath || "").trim() ||
    path.join(workspaceRootAbsolutePath, "config-params.json");
  const currentPayload = normalizeConfigParamsDocument((await readJsonRelaxed(filePath, {})) || {});
  const values = { ...currentPayload.values };
  const descriptions = { ...currentPayload.descriptions };
  const overwriteKeySet = new Set(
    (Array.isArray(overwriteKeys) ? overwriteKeys : [])
      .map(normalizeConfigParamKey)
      .filter(Boolean),
  );

  for (const [normalizedKey, incomingValue] of Object.entries(
    normalizeConfigParamValues(isPlainObject(entries) ? entries : {}),
  )) {
    if (!hasOwnProperty(values, normalizedKey)) {
      values[normalizedKey] = incomingValue;
    } else if (overwriteKeySet.has(normalizedKey)) {
      values[normalizedKey] = incomingValue;
    }
    if (!hasOwnProperty(descriptions, normalizedKey)) {
      descriptions[normalizedKey] = "";
    }
  }

  await writeJson(filePath, normalizeConfigParamsDocument({ values, descriptions }));
}

export async function repairUserConfigFile({
  targetFilePath,
  baseValues = {},
  transform = null,
} = {}) {
  const targetExists = await fileExists(targetFilePath);
  const targetRead = targetExists
    ? await readJsonWithInvalidBackup(targetFilePath)
    : { document: {}, invalidBackupPath: "" };
  const targetJson = targetRead.document;
  const seeded = typeof transform === "function" ? transform(deepClone(targetJson)) : targetJson;
  const repair = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues,
    target: seeded,
  });
  const merged = repair.document;

  if (
    !targetExists ||
    targetRead.invalidBackupPath ||
    JSON.stringify(targetJson) !== JSON.stringify(merged)
  ) {
    await writeJson(targetFilePath, merged);
    logConfigRepairReport({ targetFilePath, report: repair.report });
    logInvalidConfigBackup({
      targetFilePath,
      invalidBackupPath: targetRead.invalidBackupPath,
    });
    return true;
  }
  return false;
}

export function logInvalidConfigBackup({ targetFilePath = "", invalidBackupPath = "" } = {}) {
  if (!invalidBackupPath) return;
  console.warn(
    `[config-repair] action=${CONFIG_REPAIR_ACTION.RESTORE_INVALID_DOCUMENT}; invalid JSON preserved at ${invalidBackupPath}; restored=${targetFilePath}`,
  );
}

export function logConfigRepairReport({ targetFilePath = "", report = {} } = {}) {
  const summary = summarizeConfigRepairReport(report);
  if (!summary.changed) return;
  console.log(
    `[config-repair] file=${targetFilePath}; changes=${summary.changeCount}; actions=${JSON.stringify(summary.actionCounts)}`,
  );
}

async function readWorkspaceDirectoryEntries(workspaceRootAbsolutePath) {
  try {
    return await readdir(workspaceRootAbsolutePath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

export async function collectWorkspaceUserIds({ workspaceRootAbsolutePath } = {}) {
  const entries = await readWorkspaceDirectoryEntries(workspaceRootAbsolutePath);
  return entries
    .filter((entry) => entry.isDirectory() && String(entry.name || "").trim())
    .map((entry) => String(entry.name).trim())
    .sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
}

function applyLanguage(document, language) {
  if (!language || !isPlainObject(document)) return document;
  const localized = localizeConfigTextTree(document, resolveTextLocaleFromConfigLanguage(language));
  const preferences = isPlainObject(localized.preferences) ? { ...localized.preferences } : {};
  preferences.language = language;
  localized.preferences = preferences;
  return localized;
}

export async function syncUserConfigs({
  workspaceRootAbsolutePath,
  baseValues = {},
  language = "",
  providerAlias = "",
  locale = "zh",
} = {}) {
  await mkdir(workspaceRootAbsolutePath, { recursive: true });
  const normalizedLanguage = String(language || "").trim();
  const normalizedProviderAlias = String(providerAlias || "").trim();
  const transform = (document) => {
    const aligned = normalizedProviderAlias
      ? alignInitialModelReferences({
          globalConfig: document,
          providerAlias: normalizedProviderAlias,
        })
      : document;
    return applyLanguage(aligned, normalizedLanguage);
  };
  for (const userId of await collectWorkspaceUserIds({ workspaceRootAbsolutePath })) {
    await repairUserConfigFile({
      targetFilePath: path.join(workspaceRootAbsolutePath, userId, "config.json"),
      baseValues,
      transform,
    });
  }
  if (normalizedLanguage) {
    console.log(t(locale, "logLanguageSynced", { language: normalizedLanguage }));
  }
}

export async function ensureWorkspaceConfigParamsCatalog({
  workspaceRootAbsolutePath,
  globalConfigPath,
  explicitEntries = {},
} = {}) {
  const globalDocument = await readJsonRelaxed(globalConfigPath, {});
  const entries = Object.fromEntries(
    collectConfigTemplateKeys(globalDocument).map((key) => [key, ""]),
  );
  for (const [key, value] of Object.entries(explicitEntries || {})) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    entries[normalizedKey] = String(value ?? "").trim();
  }
  await upsertConfigParams({
    workspaceRootAbsolutePath,
    entries,
    overwriteKeys: Object.keys(explicitEntries || {}),
  });

  for (const userId of await collectWorkspaceUserIds({ workspaceRootAbsolutePath })) {
    const userConfigPath = path.join(workspaceRootAbsolutePath, userId, "config.json");
    const userEntries = Object.fromEntries(
      collectConfigTemplateKeys(globalDocument, await readJsonRelaxed(userConfigPath, {})).map(
        (key) => [key, ""],
      ),
    );
    await upsertConfigParams({
      workspaceRootAbsolutePath,
      configParamsFilePath: path.join(workspaceRootAbsolutePath, userId, "config-params.json"),
      entries: userEntries,
    });
  }
}
