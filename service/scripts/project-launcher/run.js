/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import process from "node:process";
import { resolveInitializationAnswers } from "./answers.js";
import {
  parseCliOptions,
  resolveConfiguredSuperAdminUserId,
  resolveConfiguredWorkspaceRoot,
  resolveConfiguredWorkspaceTemplatePath,
  resolveLauncherGlobalConfigPath,
} from "./cli.js";
import { mergeIncremental, pruneBuiltInConfigParams } from "./config-merge.js";
import { CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS } from "./constants.js";
import {
  ensureAgentProxyConfig,
  ensureModelProxyConfig,
  ensureWorkspaceConfigParamsCatalog,
  syncInitialModelReferencesAcrossTemplateAndUsers,
  syncLanguageAcrossTemplateAndUsers,
  syncTemplateAndUserConfigs,
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
  normalizeProviderAlias,
  resolveEnvNamesByFormat,
  resolveTemplateProvider,
} from "./provider.js";
import { fileExists, isPlainObject, readJsonStrict, writeJson, deepClone } from "./utils.js";

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

  const providerAlias = normalizeProviderAlias(answers.modelName);
  const { apiKeyEnv, baseUrlEnv } = resolveEnvNamesByFormat(answers.format);
  const apiKeyTemplateValue = `\${${apiKeyEnv}}`;
  const baseUrlTemplateValue = `\${${baseUrlEnv}}`;

  const globalConfig = localizeConfigTextTree(deepClone(globalExampleConfig), answers.setupLocale);
  globalConfig.workspace_root = answers.workspaceRoot;
  globalConfig.workspace_template_path = answers.workspaceTemplatePath;
  globalConfig.super_admin = {
    user_id: answers.superAdminUserId,
    connect_code: answers.superAdminConnectCode,
  };
  const preferences = isPlainObject(globalConfig.preferences) ? { ...globalConfig.preferences } : {};
  preferences.language = answers.configLanguage;
  globalConfig.preferences = preferences;

  const providers = isPlainObject(globalConfig.providers) ? { ...globalConfig.providers } : {};
  const aliasExists = isPlainObject(providers[providerAlias]);
  const providerSeed = aliasExists
    ? providers[providerAlias]
    : resolveTemplateProvider(providers, answers.format);
  providers[providerAlias] = buildProviderFromTemplate({
    providerTemplate: providerSeed,
    format: answers.format,
    modelName: answers.modelName,
    apiKeyVar: apiKeyTemplateValue,
    baseUrlVar: baseUrlTemplateValue,
    forceConversationDefaults: !aliasExists,
  });

  globalConfig.providers = providers;
  globalConfig.default_provider = providerAlias;
  alignInitialModelReferences({
    globalConfig,
    providerAlias,
  });

  await writeJson(globalConfigPath, globalConfig);

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, answers.workspaceRoot);
  const workspaceTemplateAbsolutePath = path.resolve(serviceRoot, answers.workspaceTemplatePath);

  await syncTemplateAndUserConfigs({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    locale: answers.setupLocale,
  });

  await syncInitialModelReferencesAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    providerAlias,
  });

  await syncLanguageAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId: answers.superAdminUserId,
    language: answers.configLanguage,
    locale: answers.setupLocale,
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
    workspaceTemplateAbsolutePath,
    explicitEntries: {
      [apiKeyEnv]: answers.apiKey,
      [baseUrlEnv]: answers.baseUrl,
    },
  });

  console.log(t(answers.setupLocale, "logInitDone"));
}

async function syncWhenGlobalConfigExists({ globalExamplePath, globalConfigPath, serviceRoot } = {}) {
  const [globalExampleConfig, globalConfig] = await Promise.all([
    readJsonStrict(globalExamplePath, t("zh", "labelGlobalExample")),
    readJsonStrict(globalConfigPath, t("zh", "labelGlobalConfig")),
  ]);

  if (!isPlainObject(globalExampleConfig) || !isPlainObject(globalConfig)) return;

  const mergedGlobal = pruneBuiltInConfigParams(mergeIncremental({
    template: pruneBuiltInConfigParams(globalExampleConfig),
    target: pruneBuiltInConfigParams(globalConfig),
    skipTopLevelKeys: CONFIG_SYNC_SKIP_TOP_LEVEL_KEYS,
  }));

  const existingConfigLanguage = String(mergedGlobal?.preferences?.language || "").trim();
  const mergedGlobalLocalized = existingConfigLanguage
    ? localizeConfigTextTree(
        mergedGlobal,
        resolveTextLocaleFromConfigLanguage(existingConfigLanguage),
      )
    : mergedGlobal;

  if (JSON.stringify(globalConfig) !== JSON.stringify(mergedGlobalLocalized)) {
    await writeJson(globalConfigPath, mergedGlobalLocalized);
  }

  const workspaceRootRelative = resolveConfiguredWorkspaceRoot(mergedGlobalLocalized);
  const workspaceTemplateRelative = resolveConfiguredWorkspaceTemplatePath(mergedGlobalLocalized);
  const superAdminUserId = resolveConfiguredSuperAdminUserId(mergedGlobalLocalized);

  const workspaceRootAbsolutePath = path.resolve(serviceRoot, workspaceRootRelative);
  const workspaceTemplateAbsolutePath = path.resolve(serviceRoot, workspaceTemplateRelative);

  await syncTemplateAndUserConfigs({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId,
    locale: normalizeSetupLocale(process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG, "zh"),
  });

  await syncLanguageAcrossTemplateAndUsers({
    workspaceRootAbsolutePath,
    workspaceTemplateAbsolutePath,
    superAdminUserId,
    language: String(mergedGlobalLocalized?.preferences?.language || "").trim(),
    locale: normalizeSetupLocale(process.env.NOOBOT_SETUP_LANG || process.env.NOOBOT_LANG || process.env.LANG, "zh"),
  });

  await ensureWorkspaceConfigParamsCatalog({
    workspaceRootAbsolutePath,
    globalConfigPath,
    workspaceTemplateAbsolutePath,
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
