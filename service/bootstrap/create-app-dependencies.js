/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BotManager } from "#agent/bot-manage";
import { createGlobalConfigBuilder } from "#agent/config";
import {
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  DEFAULT_LOCALE
} from "noobot-i18n/service";
import { BACKEND_I18N } from "noobot-i18n/service/backend-messages";
import { createAuthService } from "../services/auth-service.js";
import { createChatRunService } from "../services/chat-run-service.js";
import { createConfigParamsService } from "../services/config-params-service.js";
import { createConfigScopeService } from "../services/config-scope-service.js";
import { createRequestContextService } from "../services/request-context-service.js";
import { createRuntimeConfigService } from "../services/runtime-config-service.js";
import { createWorkspacePathService } from "../services/workspace-path-service.js";
import { createWorkspaceUsersService } from "../services/workspace-users-service.js";
import { createOpenVSCodeService } from "../services/openvscode-service.js";

const DEFAULT_WORKSPACE_USERS_CONFIG = {
  users: [
    {
      userId: "xiayu",
      connectCode: "change-your-connect-code",
    },
  ],
};

export async function createAppDependencies({
  globalConfigBuilder,
  initConnectorHistoryStore,
  getConnectorChannelStore,
  getConnectorHistoryStore,
  buildWorkspaceTree,
} = {}) {
  const configBuilder =
    globalConfigBuilder && typeof globalConfigBuilder?.build === "function"
      ? globalConfigBuilder
      : createGlobalConfigBuilder();
  const initialRawConfig =
    (await configBuilder?.loadRawConfig?.({ reload: false })) || {};
  let globalConfigRaw = initialRawConfig;
  let globalConfig = globalConfigRaw;
  let bot = null;

  const requestContextService = createRequestContextService({
    normalizeLocale,
    resolveLocaleFromAcceptLanguage,
    pickLocaleText,
    defaultLocale: DEFAULT_LOCALE,
    i18nDict: BACKEND_I18N,
  });
  const { resolveRequestLocale, translateText } = requestContextService;

  const workspacePathService = createWorkspacePathService({
    getGlobalConfig: () => globalConfig,
    getGlobalConfigRaw: () => globalConfigRaw,
  });
  const { workspaceRootPath, templateRootPath } = workspacePathService;

  const configParamsService = createConfigParamsService({
    workspaceRootPath,
    getGlobalConfigRaw: () => globalConfigRaw,
    templateRootPath,
  });
  const {
    normalizeConfigParams,
    readWorkspaceConfigParams,
    writeWorkspaceConfigParams,
    readUserConfigParams,
    writeUserConfigParams,
    collectConfigTemplateKeys,
    collectUserConfigTemplateKeys,
    buildConfigParamCatalog,
  } = configParamsService;

  const workspaceUsersService = createWorkspaceUsersService({
    workspaceRootPath,
    defaultWorkspaceUsersConfig: DEFAULT_WORKSPACE_USERS_CONFIG,
  });
  const {
    normalizeWorkspaceUsersConfig,
    readWorkspaceUsersConfig,
    writeWorkspaceUsersConfig,
    readWorkspaceUsers,
  } = workspaceUsersService;

  const authService = createAuthService({
    initialApiKeyTtlMs: Number(globalConfig?.auth?.apiKeyTtlMs || 24 * 60 * 60 * 1000),
    translateText,
  });
  const {
    setApiKeyTtlMs,
    issueApiKey,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    requireApiKey,
    requireSuperAdmin,
  } = authService;

  const chatRunService = createChatRunService({
    getBot: () => bot,
    normalizeLocale,
    defaultLocale: DEFAULT_LOCALE,
    translateText,
  });
  const {
    normalizeSelectedConnectors,
    normalizeRunConfig,
    handleChat,
  } = chatRunService;

  const configScopeService = createConfigScopeService({
    readWorkspaceConfigParams,
    readUserConfigParams,
    writeWorkspaceConfigParams,
    writeUserConfigParams,
    collectConfigTemplateKeys,
    collectUserConfigTemplateKeys,
    buildConfigParamCatalog,
    translateText,
  });
  const {
    resolveConfigParamScope,
    readScopedConfigParams,
    writeScopedConfigParams,
    buildScopedConfigParamsResponse,
  } = configScopeService;

  const openVSCodeService = createOpenVSCodeService({
    getGlobalConfig: () => globalConfig,
    workspaceRootPath,
    ensureUserWorkspace: async (userId = "") => {
      if (!bot || typeof bot.ensureUserWorkspace !== "function") return "";
      return bot.ensureUserWorkspace(userId);
    },
  });

  const runtimeConfigService = createRuntimeConfigService({
    readWorkspaceConfigParams,
    globalConfigBuilder: configBuilder,
    BotManager,
    setApiKeyTtlMs,
    setGlobalConfigRaw: (nextGlobalConfigRaw) => {
      globalConfigRaw = nextGlobalConfigRaw || {};
    },
    setGlobalConfig: (nextGlobalConfig) => {
      globalConfig = nextGlobalConfig;
    },
    setBot: (nextBot) => {
      bot = nextBot;
    },
    workspaceRootPath,
    initConnectorHistoryStore,
  });
  const { rebuildRuntimeConfig } = runtimeConfigService;

  await rebuildRuntimeConfig();

  return {
    normalizeLocale,
    defaultLocale: DEFAULT_LOCALE,
    resolveRequestLocale,
    translateText,
    normalizeRunConfig,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    workspaceRootPath,
    getBot: () => bot,
    openVSCodeService,
    buildHttpModuleDependencies: () => ({
      bot,
      openVSCodeService,
      globalConfigProvider: () => globalConfig,
      issueApiKey,
      readWorkspaceUsers,
      readWorkspaceUsersConfig,
      writeWorkspaceUsersConfig,
      normalizeWorkspaceUsersConfig,
      requireSuperAdmin,
      requireApiKey,
      resolveConfigParamScope,
      readScopedConfigParams,
      writeScopedConfigParams,
      buildScopedConfigParamsResponse,
      normalizeConfigParams,
      readWorkspaceConfigParams,
      readUserConfigParams,
      collectConfigTemplateKeys,
      collectUserConfigTemplateKeys,
      buildConfigParamCatalog,
      rebuildRuntimeConfig,
      templateRootPath,
      buildWorkspaceTree,
      getConnectorChannelStore,
      getConnectorHistoryStore,
      normalizeSelectedConnectors,
      workspaceRootPath,
      handleChat,
      translateText,
    }),
  };
}
