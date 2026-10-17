/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BotManager } from "#agent/bot";
import { resolveConfiguredSuperUserId } from "../deps/agent-utils.js";
import {
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  DEFAULT_LOCALE,
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
import { text, isFunction } from "@noobot/shared/value";

export async function createAppDependencies({
  serviceDir,
  startupContext = {},
  globalConfigBuilder,
  buildWorkspaceTree,
  connectorAccessPort,
} = {}) {
  if (!isFunction(globalConfigBuilder?.build)) {
    throw new TypeError("createAppDependencies requires globalConfigBuilder");
  }
  const configBuilder = globalConfigBuilder;
  const initialRawConfig = await configBuilder.loadRawConfig({ reload: false });
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
    serviceDir,
    getGlobalConfigRaw: () => globalConfigRaw,
  });
  const { workspaceRootPath, templateRootPath } = workspacePathService;
  workspacePathService.assertWorkspaceRootMatchesEnv();

  const configParamsService = createConfigParamsService({
    workspaceRootPath,
    getGlobalConfigRaw: () => globalConfigRaw,
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

  const { mapAgentRunCommand } = createChatRunService({
    normalizeLocale,
    defaultLocale: DEFAULT_LOCALE,
  });

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
    startupContext,
    readWorkspaceConfigParams,
    globalConfigBuilder: configBuilder,
    BotManager,
    setApiKeyTtlMs,
    setGlobalConfigRaw: (nextGlobalConfigRaw) => {
      globalConfigRaw = nextGlobalConfigRaw;
    },
    setGlobalConfig: (nextGlobalConfig) => {
      globalConfig = nextGlobalConfig;
    },
    setBot: (nextBot) => {
      bot = nextBot;
    },
    connectorAccessPort,
  });
  const { rebuildRuntimeConfig } = runtimeConfigService;

  await rebuildRuntimeConfig();

  async function readSessionUserIds() {
    const workspaceUsers = await readWorkspaceUsers();
    const superAdminUserId = resolveConfiguredSuperUserId(globalConfig);
    return [
      ...new Set(
        [...workspaceUsers.map((user) => text(user?.userId)), superAdminUserId].filter(Boolean),
      ),
    ];
  }

  return {
    normalizeLocale,
    defaultLocale: DEFAULT_LOCALE,
    resolveRequestLocale,
    translateText,
    mapAgentRunCommand,
    resolveAuthByApiKey,
    isForbiddenUserScope,
    workspaceRootPath,
    getBot: () => bot,
    getGlobalConfig: () => globalConfig,
    readSessionUserIds,
    openVSCodeService,
    buildHttpModuleDependencies: () => ({
      pluginRootDir: text(startupContext?.paths?.pluginRootDir),
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
      resolveAuthByApiKey,
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
      workspaceRootPath,
      translateText,
    }),
  };
}
