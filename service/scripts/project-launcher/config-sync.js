/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS } from "./constants.js";
import { mergeIncremental, parseTemplateVariables, pruneBuiltInConfigParams } from "./config-merge.js";
import { localizeConfigTextTree, resolveTextLocaleFromConfigLanguage, t } from "./i18n.js";
import { alignInitialModelReferencesForFile } from "./provider.js";
import {
  deepClone,
  fileExists,
  hasOwnProperty,
  isPlainObject,
  readJsonRelaxed,
  readJsonStrict,
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
  entries = {},
  overwriteKeys = [],
} = {}) {
  const filePath = path.join(workspaceRootAbsolutePath, "config-params.json");
  const currentPayload = (await readJsonRelaxed(filePath, {})) || {};
  const values = isPlainObject(currentPayload?.values) ? { ...currentPayload.values } : {};
  const descriptions = isPlainObject(currentPayload?.descriptions)
    ? { ...currentPayload.descriptions }
    : {};
  const overwriteKeySet = new Set(
    (Array.isArray(overwriteKeys) ? overwriteKeys : [])
      .map((key) => String(key || "").trim().toUpperCase())
      .filter(Boolean),
  );

  for (const [key, value] of Object.entries(entries || {})) {
    const normalizedKey = String(key || "").trim().toUpperCase();
    if (!normalizedKey) continue;
    const incomingValue = String(value ?? "").trim();
    if (!hasOwnProperty(values, normalizedKey)) {
      values[normalizedKey] = incomingValue;
    } else if (overwriteKeySet.has(normalizedKey)) {
      // 仅允许用户本次录入变量覆盖已有值
      values[normalizedKey] = incomingValue;
    }
    if (!hasOwnProperty(descriptions, normalizedKey)) {
      descriptions[normalizedKey] = "";
    }
  }

  await writeJson(filePath, {
    values,
    descriptions,
  });
}

export async function syncJsonFileIncremental({ templateFilePath, targetFilePath, skipTopLevelKeys = new Set(), locale = "zh" } = {}) {
  const templateJson = await readJsonStrict(templateFilePath, t(locale, "labelTemplateConfig"));
  if (!isPlainObject(templateJson)) return false;

  const targetExists = await fileExists(targetFilePath);
  const targetJson = targetExists
    ? await readJsonStrict(targetFilePath, t(locale, "labelTargetConfig"))
    : {};
  const merged = pruneBuiltInConfigParams(mergeIncremental({
    template: pruneBuiltInConfigParams(templateJson),
    target: pruneBuiltInConfigParams(targetJson),
    skipTopLevelKeys,
  }));

  if (!targetExists || JSON.stringify(targetJson) !== JSON.stringify(merged)) {
    await writeJson(targetFilePath, merged);
    return true;
  }
  return false;
}

export async function collectWorkspaceUserIds({ workspaceRootAbsolutePath, superAdminUserId = "" } = {}) {
  const userIds = new Set();
  const workspaceDirUserIds = new Set();

  try {
    const entries = await readdir(workspaceRootAbsolutePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userId = String(entry.name || "").trim();
      if (!userId) continue;
      workspaceDirUserIds.add(userId);
    }
  } catch {
    // ignore
  }

  // 仅同步已经初始化（目录已存在）的用户，不主动创建新用户目录
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

  return Array.from(userIds).sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
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
      skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
      locale,
    });
  } else if (templateConfigExists) {
    await syncJsonFileIncremental({
      templateFilePath: templateConfigPath,
      targetFilePath: templateExamplePath,
      skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
      locale,
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
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    }
    if (finalTemplateExampleExists) {
      await syncJsonFileIncremental({
        templateFilePath: templateExamplePath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
      });
    } else if (finalTemplateSeedPath) {
      await syncJsonFileIncremental({
        templateFilePath: finalTemplateSeedPath,
        targetFilePath: path.join(userBasePath, "config.example.json"),
        skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
        locale,
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
  const keys = new Set();
  if (await fileExists(globalConfigPath)) {
    const globalConfig = await readJsonRelaxed(globalConfigPath, {});
    parseTemplateVariables(globalConfig, keys);
  }
  const templateConfigPath = path.join(workspaceTemplateAbsolutePath, "config.json");
  const templateExamplePath = path.join(workspaceTemplateAbsolutePath, "config.example.json");
  if (await fileExists(templateConfigPath)) {
    const templateConfig = await readJsonRelaxed(templateConfigPath, {});
    parseTemplateVariables(templateConfig, keys);
  }
  if (await fileExists(templateExamplePath)) {
    const templateExample = await readJsonRelaxed(templateExamplePath, {});
    parseTemplateVariables(templateExample, keys);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
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
}
