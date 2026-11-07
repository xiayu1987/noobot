/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import {
  collectConfigTemplateKeys,
  CONFIG_DOCUMENT_SCOPE,
  AgentConfigProtocolError,
  configIssueBlocksStartup,
  normalizeConfigParamKey,
  normalizeConfigParamValues,
  normalizeConfigParamsDocument,
  repairConfigDocument,
  upgradeConfigModelLibrary,
  summarizeConfigRepairReport,
} from "@noobot/agent-config-protocol";
import { localizeConfigTextTree, resolveTextLocaleFromConfigLanguage, t } from "./i18n.js";
import { alignInitialModelReferences } from "./provider.js";
import { deepClone, fileExists, hasOwnProperty, readConfigDocument, writeJson } from "./utils.js";

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

async function upsertConfigParams({
  workspaceRootAbsolutePath,
  configParamsFilePath = "",
  entries = {},
  overwriteKeys = [],
} = {}) {
  const filePath =
    text(configParamsFilePath) || path.join(workspaceRootAbsolutePath, "config-params.json");
  const currentPayload = normalizeConfigParamsDocument(
    await readConfigDocument(filePath, { allowMissing: true }),
  );
  const values = { ...currentPayload.values };
  const descriptions = { ...currentPayload.descriptions };
  const overwriteKeySet = new Set(
    (Array.isArray(overwriteKeys) ? overwriteKeys : [])
      .map(normalizeConfigParamKey)
      .filter(Boolean),
  );

  for (const [normalizedKey, incomingValue] of Object.entries(
    normalizeConfigParamValues(entries),
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

async function repairUserConfigFile({ targetFilePath, baseValues = {}, transform = null } = {}) {
  const targetExists = await fileExists(targetFilePath);
  const targetJson = targetExists ? await readConfigDocument(targetFilePath) : {};
  const seeded = typeof transform === "function" ? transform(deepClone(targetJson)) : targetJson;
  const repair = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues,
    target: upgradeConfigModelLibrary(seeded).document,
  });
  const merged = repair.document;
  logConfigRepairReport({ targetFilePath, report: repair.report });

  if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
    await writeJson(targetFilePath, merged);
    return true;
  }
  return false;
}

export function logConfigRepairReport({ targetFilePath = "", report = {} } = {}) {
  const summary = summarizeConfigRepairReport(report);
  for (const issue of report.issues || []) {
    console.warn(`[config-diagnostic] file=${targetFilePath}; issue=${JSON.stringify(issue)}`);
  }
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

async function collectWorkspaceUserIds({ workspaceRootAbsolutePath } = {}) {
  const entries = await readWorkspaceDirectoryEntries(workspaceRootAbsolutePath);
  return entries
    .filter((entry) => entry.isDirectory() && text(entry.name))
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

function reportUserConfigError(error, targetFilePath) {
  if (
    !(error instanceof AgentConfigProtocolError) ||
    !error.details.impact ||
    configIssueBlocksStartup(error.details, CONFIG_DOCUMENT_SCOPE.USER)
  )
    throw error;
  logConfigRepairReport({ targetFilePath, report: { issues: [error.details] } });
}

export async function syncUserConfigs({
  workspaceRootAbsolutePath,
  baseValues = {},
  language = "",
  providerAlias = "",
  locale = "zh",
} = {}) {
  await mkdir(workspaceRootAbsolutePath, { recursive: true });
  const normalizedLanguage = text(language);
  const normalizedProviderAlias = text(providerAlias);
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
    const targetFilePath = path.join(workspaceRootAbsolutePath, userId, "config.json");
    try {
      await repairUserConfigFile({ targetFilePath, baseValues, transform });
    } catch (error) {
      reportUserConfigError(error, targetFilePath);
    }
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
  const globalDocument = await readConfigDocument(globalConfigPath);
  const entries = Object.fromEntries(
    collectConfigTemplateKeys(globalDocument).map((key) => [key, ""]),
  );
  const normalizedEntries = normalizeConfigParamValues(explicitEntries);
  Object.assign(entries, normalizedEntries);
  await upsertConfigParams({
    workspaceRootAbsolutePath,
    entries,
    overwriteKeys: Object.keys(normalizedEntries),
  });

  for (const userId of await collectWorkspaceUserIds({ workspaceRootAbsolutePath })) {
    const userConfigPath = path.join(workspaceRootAbsolutePath, userId, "config.json");
    let userDocument;
    try {
      userDocument = await readConfigDocument(userConfigPath, { allowMissing: true });
    } catch (error) {
      reportUserConfigError(error, userConfigPath);
      continue;
    }
    const userParamsPath = path.join(workspaceRootAbsolutePath, userId, "config-params.json");
    try {
      await upsertConfigParams({
        workspaceRootAbsolutePath,
        configParamsFilePath: userParamsPath,
        entries: Object.fromEntries(
          collectConfigTemplateKeys(globalDocument, userDocument).map((key) => [key, ""]),
        ),
      });
    } catch (error) {
      reportUserConfigError(error, userParamsPath);
    }
  }
}
