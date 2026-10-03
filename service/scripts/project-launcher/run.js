/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import process from "node:process";
import { CONFIG_DOCUMENT_SCOPE, repairConfigDocument } from "@noobot/agent-config-protocol";
import { resolveInitializationAnswers } from "./answers.js";
import {
  parseCliOptions,
  resolveConfiguredWorkspaceRoot,
  resolveLauncherGlobalConfigPath,
} from "./cli.js";
import {
  ensureAgentProxyConfig,
  ensureModelProxyConfig,
  ensureWorkspaceConfigParamsCatalog,
  logConfigRepairReport,
  logInvalidConfigBackup,
  syncUserConfigs,
} from "./config-sync.js";
import {
  localizeConfigTextTree,
  normalizeSetupLocale,
  resolveTextLocaleFromConfigLanguage,
  t,
} from "./i18n.js";
import {
  alignInitialModelReferences,
  buildProviderFromTemplate,
  parseTemplateVariableName,
  resolveProviderTemplate,
} from "./provider.js";
import {
  deepClone,
  fileExists,
  isPlainObject,
  readJsonStrict,
  readJsonWithInvalidBackup,
  writeJson,
} from "./utils.js";

async function initializeGlobalConfigWhenMissing({
  globalExamplePath,
  globalConfigPath,
  serviceRoot,
  cliOptions,
} = {}) {
  const answers = await resolveInitializationAnswers({ cliOptions });
  const globalExampleConfig = await readJsonStrict(
    globalExamplePath,
    t(answers.setupLocale, "labelGlobalExample"),
  );
  if (!isPlainObject(globalExampleConfig)) {
    throw new Error(`invalid global config example: ${globalExamplePath}`);
  }

  const globalConfig = localizeConfigTextTree(deepClone(globalExampleConfig), answers.setupLocale);
  globalConfig.workspace_root = answers.workspaceRoot;
  globalConfig.workspace_template_path = answers.workspaceTemplatePath;
  globalConfig.super_admin = {
    user_id: answers.superAdminUserId,
    connect_code: answers.superAdminConnectCode,
  };
  const preferences = isPlainObject(globalConfig.preferences)
    ? { ...globalConfig.preferences }
    : {};
  preferences.language = answers.configLanguage;
  globalConfig.preferences = preferences;

  const security = isPlainObject(globalConfig.security) ? { ...globalConfig.security } : {};
  security.execution_isolation = {
    ...(isPlainObject(security.execution_isolation) ? security.execution_isolation : {}),
    mode: answers.executionIsolationMode,
  };
  globalConfig.security = security;

  const providerAlias = answers.modelKey;
  const providers = isPlainObject(globalConfig.providers) ? { ...globalConfig.providers } : {};
  const aliasExists = isPlainObject(providers[providerAlias]);
  providers[providerAlias] = buildProviderFromTemplate({
    providerTemplate: resolveProviderTemplate(providers, providerAlias),
    forceConversationDefaults: !aliasExists,
  });

  const explicitEntries = {};
  const apiKeyEnv = parseTemplateVariableName(providers[providerAlias].api_key);
  const baseUrlEnv = parseTemplateVariableName(providers[providerAlias].base_url);
  if (answers.apiKey && apiKeyEnv) explicitEntries[apiKeyEnv] = answers.apiKey;
  if (answers.baseUrl && baseUrlEnv) explicitEntries[baseUrlEnv] = answers.baseUrl;

  globalConfig.providers = providers;
  globalConfig.default_provider = providerAlias;
  alignInitialModelReferences({
    globalConfig,
    providerAlias,
  });

  await writeJson(globalConfigPath, globalConfig);

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, answers.workspaceRoot);

  await syncUserConfigs({
    workspaceRootAbsolutePath,
    baseValues: globalConfig,
    language: answers.configLanguage,
    providerAlias,
    locale: answers.setupLocale,
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
    explicitEntries,
  });

  console.log(t(answers.setupLocale, "logInitDone"));
}

async function syncWhenGlobalConfigExists({
  globalExamplePath,
  globalConfigPath,
  serviceRoot,
} = {}) {
  const [globalExampleConfig, globalRead] = await Promise.all([
    readJsonStrict(globalExamplePath, t("zh", "labelGlobalExample")),
    readJsonWithInvalidBackup(globalConfigPath),
  ]);
  const globalConfig = globalRead.document;

  if (!isPlainObject(globalExampleConfig) || !isPlainObject(globalConfig)) return;

  const globalRepair = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: globalExampleConfig,
    target: globalConfig,
  });
  const mergedGlobal = globalRepair.document;

  const existingConfigLanguage = String(mergedGlobal?.preferences?.language || "").trim();
  const mergedGlobalLocalized = existingConfigLanguage
    ? localizeConfigTextTree(
        mergedGlobal,
        resolveTextLocaleFromConfigLanguage(existingConfigLanguage),
      )
    : mergedGlobal;

  if (JSON.stringify(globalConfig) !== JSON.stringify(mergedGlobalLocalized)) {
    await writeJson(globalConfigPath, mergedGlobalLocalized);
    logConfigRepairReport({ targetFilePath: globalConfigPath, report: globalRepair.report });
    logInvalidConfigBackup({
      targetFilePath: globalConfigPath,
      invalidBackupPath: globalRead.invalidBackupPath,
    });
  }

  const workspaceRootRelative = resolveConfiguredWorkspaceRoot(mergedGlobalLocalized);

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, workspaceRootRelative);

  await syncUserConfigs({
    workspaceRootAbsolutePath,
    baseValues: mergedGlobalLocalized,
    language: String(mergedGlobalLocalized?.preferences?.language || "").trim(),
    locale: normalizeSetupLocale(
      process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG,
      "zh",
    ),
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
  });
}

export async function runProjectLauncher() {
  const serviceRoot = process.cwd();
  const cliOptions = parseCliOptions(process.argv.slice(2));
  const globalConfigPath = resolveLauncherGlobalConfigPath({ serviceRoot, cliOptions });
  const globalExamplePath = path.resolve(serviceRoot, "./config/global.config.example.json");

  await ensureModelProxyConfig({ serviceRoot });
  await ensureAgentProxyConfig({ serviceRoot });

  if (!(await fileExists(globalConfigPath))) {
    await initializeGlobalConfigWhenMissing({
      globalExamplePath,
      globalConfigPath,
      serviceRoot,
      cliOptions,
    });
    return;
  }

  await syncWhenGlobalConfigExists({
    globalExamplePath,
    globalConfigPath,
    serviceRoot,
  });
}
