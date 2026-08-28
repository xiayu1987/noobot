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
import { alignInitialModelReferencesForFile } from "./provider.js";
import {
  deepClone,
  fileExists,
  hasOwnProperty,
  isPlainObject,
  readJsonRelaxed,
  readJsonStrict,
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

export async function syncJsonFileIncremental({
  templateFilePath,
  targetFilePath,
  locale = "zh",
  scope = CONFIG_DOCUMENT_SCOPE.USER,
} = {}) {
  const templateJson = await readJsonStrict(templateFilePath, t(locale, "labelTemplateConfig"));
  if (!isPlainObject(templateJson)) return false;

  const targetExists = await fileExists(targetFilePath);
  const targetRead = targetExists
    ? await readJsonWithInvalidBackup(targetFilePath)
    : { document: {}, invalidBackupPath: "" };
  const targetJson = targetRead.document;
  const repair = repairConfigDocument({
    scope,
    template: templateJson,
    target: targetJson,
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

export async function collectWorkspaceUserIds({
  workspaceRootAbsolutePath,
  superAdminUserId = "",
} = {}) {
  const userIds = new Set();
  const workspaceDirUserIds = new Set();

  const entries = await readWorkspaceDirectoryEntries(workspaceRootAbsolutePath);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const userId = String(entry.name || "").trim();
    if (!userId) continue;
    workspaceDirUserIds.add(userId);
  }

  for (const userId of workspaceDirUserIds) {
    userIds.add(userId);
  }

  const normalizedSuperAdminUserId = String(superAdminUserId || "").trim();
  if (normalizedSuperAdminUserId && workspaceDirUserIds.has(normalizedSuperAdminUserId)) {
    userIds.add(normalizedSuperAdminUserId);
  }

  const usersFilePath = path.join(workspaceRootAbsolutePath, "user.json");
  const usersPayload = await readJsonRelaxed(usersFilePath, {});
  const users = Array.isArray(usersPayload?.users) ? usersPayload.users : [];
  for (const userItem of users) {
    const userId = String(userItem?.userId || "").trim();
    if (userId && workspaceDirUserIds.has(userId)) {
      userIds.add(userId);
    }
  }

  return Array.from(userIds).sort((leftUserId, rightUserId) =>
    leftUserId.localeCompare(rightUserId),
  );
}

export async function syncTemplateAndUserConfigs({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  locale = "zh",
} = {}) {
  await mkdir(workspaceTemplateAbsolutePath, { recursive: true });
  await mkdir(workspaceRootAbsolutePath, { recursive: true });

  const templateExamplePath = path.join(workspaceTemplateAbsolutePath, "config.example.json");
  const templateConfigPath = path.join(workspaceTemplateAbsolutePath, "config.json");
  const templateExampleExists = await fileExists(templateExamplePath);
  const templateConfigExists = await fileExists(templateConfigPath);
  const templateSeedPath = templateExampleExists
    ? templateExamplePath
    : templateConfigExists
      ? templateConfigPath
      : "";

  if (!templateSeedPath) {
    console.warn(t(locale, "warnTemplateMissing", { path: workspaceTemplateAbsolutePath }));
    return;
  }

  if (templateExampleExists) {
    await syncJsonFileIncremental({
      templateFilePath: templateExamplePath,
      targetFilePath: templateConfigPath,
      locale,
      scope: CONFIG_DOCUMENT_SCOPE.USER_DEFAULT,
    });
  } else if (templateConfigExists) {
    await syncJsonFileIncremental({
      templateFilePath: templateConfigPath,
      targetFilePath: templateExamplePath,
      locale,
      scope: CONFIG_DOCUMENT_SCOPE.USER_DEFAULT,
    });
  }

  const finalTemplateConfigExists = await fileExists(templateConfigPath);
  const finalTemplateExampleExists = await fileExists(templateExamplePath);
  const finalTemplateSeedPath = finalTemplateConfigExists
    ? templateConfigPath
    : finalTemplateExampleExists
      ? templateExamplePath
      : "";

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });

  for (const userId of userIds) {
    const userBasePath = path.join(workspaceRootAbsolutePath, userId);
    await mkdir(userBasePath, { recursive: true });
    if (finalTemplateConfigExists) {
      await syncJsonFileIncremental({
        templateFilePath: templateConfigPath,
        targetFilePath: path.join(userBasePath, "config.json"),
        locale,
        scope: CONFIG_DOCUMENT_SCOPE.USER,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.json"),
        locale,
        scope: CONFIG_DOCUMENT_SCOPE.USER,
      });
    }
    if (finalTemplateExampleExists) {
      await syncJsonFileIncremental({
        templateFilePath: templateExamplePath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        locale,
        scope: CONFIG_DOCUMENT_SCOPE.USER,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        locale,
        scope: CONFIG_DOCUMENT_SCOPE.USER,
      });
    }
  }
}

async function syncLanguageForFile(filePath = "", language = "", textLocale = "zh") {
  if (!filePath || !language) return;
  if (!(await fileExists(filePath))) return;
  const payload = await readJsonStrict(filePath, "config");
  if (!isPlainObject(payload)) return;
  const nextPayload = localizeConfigTextTree(deepClone(payload), textLocale);
  const preferences = isPlainObject(nextPayload.preferences) ? { ...nextPayload.preferences } : {};
  preferences.language = language;
  nextPayload.preferences = preferences;
  if (JSON.stringify(nextPayload) !== JSON.stringify(payload)) {
    await writeJson(filePath, nextPayload);
  }
}

export async function syncLanguageAcrossTemplateAndUsers({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  language,
  locale = "zh",
} = {}) {
  if (!language) return;
  const textLocale = resolveTextLocaleFromConfigLanguage(language);
  const templateTargets = [
    path.join(workspaceTemplateAbsolutePath, "config.json"),
    path.join(workspaceTemplateAbsolutePath, "config.example.json"),
  ];
  for (const targetPath of templateTargets) {
    await syncLanguageForFile(targetPath, language, textLocale);
  }

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });
  for (const userId of userIds) {
    await syncLanguageForFile(
      path.join(workspaceRootAbsolutePath, userId, "config.json"),
      language,
      textLocale,
    );
    await syncLanguageForFile(
      path.join(workspaceRootAbsolutePath, userId, "config.example.json"),
      language,
      textLocale,
    );
  }

  console.log(t(locale, "logLanguageSynced", { language }));
}

export async function syncInitialModelReferencesAcrossTemplateAndUsers({
  workspaceRootAbsolutePath,
  workspaceTemplateAbsolutePath,
  superAdminUserId,
  providerAlias,
} = {}) {
  const normalizedProviderAlias = String(providerAlias || "").trim();
  if (!normalizedProviderAlias) return;

  const templateTargets = [
    path.join(workspaceTemplateAbsolutePath, "config.json"),
    path.join(workspaceTemplateAbsolutePath, "config.example.json"),
  ];
  for (const targetPath of templateTargets) {
    await alignInitialModelReferencesForFile({
      filePath: targetPath,
      providerAlias: normalizedProviderAlias,
    });
  }

  const userIds = await collectWorkspaceUserIds({
    workspaceRootAbsolutePath,
    superAdminUserId,
  });
  for (const userId of userIds) {
    await alignInitialModelReferencesForFile({
      filePath: path.join(workspaceRootAbsolutePath, userId, "config.json"),
      providerAlias: normalizedProviderAlias,
    });
    await alignInitialModelReferencesForFile({
      filePath: path.join(workspaceRootAbsolutePath, userId, "config.example.json"),
      providerAlias: normalizedProviderAlias,
    });
  }
}

async function collectTemplateParamKeys({ globalConfigPath, workspaceTemplateAbsolutePath } = {}) {
  const documents = [];
  if (await fileExists(globalConfigPath)) {
    documents.push(await readJsonRelaxed(globalConfigPath, {}));
  }
  const templateConfigPath = path.join(workspaceTemplateAbsolutePath, "config.json");
  const templateExamplePath = path.join(workspaceTemplateAbsolutePath, "config.example.json");
  if (await fileExists(templateConfigPath)) {
    documents.push(await readJsonRelaxed(templateConfigPath, {}));
  }
  if (await fileExists(templateExamplePath)) {
    documents.push(await readJsonRelaxed(templateExamplePath, {}));
  }
  return collectConfigTemplateKeys(...documents);
}

export async function ensureWorkspaceConfigParamsCatalog({
  workspaceRootAbsolutePath,
  globalConfigPath,
  workspaceTemplateAbsolutePath,
  explicitEntries = {},
} = {}) {
  const templateKeys = await collectTemplateParamKeys({
    globalConfigPath,
    workspaceTemplateAbsolutePath,
  });
  const entries = {};
  for (const key of templateKeys) {
    entries[key] = "";
  }
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
    const userExamplePath = path.join(workspaceRootAbsolutePath, userId, "config.example.json");
    const userDocuments = [
      await readJsonRelaxed(globalConfigPath, {}),
      await readJsonRelaxed(path.join(workspaceTemplateAbsolutePath, "config.json"), {}),
      await readJsonRelaxed(path.join(workspaceTemplateAbsolutePath, "config.example.json"), {}),
      await readJsonRelaxed(userConfigPath, {}),
      await readJsonRelaxed(userExamplePath, {}),
    ];
    const userEntries = Object.fromEntries(
      collectConfigTemplateKeys(...userDocuments).map((key) => [key, ""]),
    );
    await upsertConfigParams({
      workspaceRootAbsolutePath,
      configParamsFilePath: path.join(workspaceRootAbsolutePath, userId, "config-params.json"),
      entries: userEntries,
    });
  }
}
