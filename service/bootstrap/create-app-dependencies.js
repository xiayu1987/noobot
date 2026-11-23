/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BotManager } from "#agent/bot";
import { createPartitionSessionServices } from "noobot-agent/session";
import { assertWorkspaceStorageReady } from "noobot-agent/workspace-session-storage";
import { resolveConfiguredSuperUserId } from "../deps/agent-utils.js";
import {
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocaleText,
  DEFAULT_LOCALE,
} from "noobot-i18n/service";
import { BACKEND_I18N } from "noobot-i18n/service/backend-messages";
import { createAuthService, USER_SCOPE_POLICY } from "../services/auth-service.js";
import { createChatRunService } from "../services/chat-run-service.js";
import { createConfigParamsService } from "../services/config-params-service.js";
import { createConfigScopeService } from "../services/config-scope-service.js";
import { createRequestContextService } from "../services/request-context-service.js";
import { createRuntimeConfigService } from "../services/runtime-config-service.js";
import { createServiceBotAccess } from "../services/service-bot-access.js";
import { createWorkspacePathService } from "../services/workspace-path-service.js";
import { createWorkspaceUsersService } from "../services/workspace-users-service.js";
import { createOpenVSCodeService } from "../services/openvscode-service.js";
import { resolveWorkspaceRootPath } from "@noobot/runtime-topology-protocol/workspace-root";
import { text, isFunction } from "@noobot/shared/value";

export function createConfiguredSessionRuntime(config, dependencies) {
  const { journalLimits, maxJournals } = config.partitionSessionStorage;
  return createPartitionSessionServices(config, {
    ...dependencies,
    journalLimits,
    maxJournals,
  });
}

export async function createAppDependencies({
  serviceDir,
  startupContext,
  globalConfigBuilder,
  buildWorkspaceTree,
  connectorAccessPort,
} = {}) {
  if (!isFunction(globalConfigBuilder?.build)) {
    throw new TypeError("createAppDependencies requires globalConfigBuilder");
  }
  const configBuilder = globalConfigBuilder;

  const now = () => new Date().toISOString();
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
  const { templateRootPath } = workspacePathService;
  const workspaceRoot = workspacePathService.assertWorkspaceRootMatchesEnv();
  const workspaceRootPath = () => workspaceRoot;

  const configParamsService = createConfigParamsService({
    workspaceRootPath,
    getGlobalConfigRaw: () => globalConfigRaw,
  });
  const {
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
    translateText,
  });
  const {
    issueApiKey,
    issueResourceAccess,
    resolveAuthByApiKey,
    requireApiKey,
    createUserScopeParam,
    requireSuperAdmin,
  } = authService;
  const administrableUserScopeParam = createUserScopeParam(USER_SCOPE_POLICY.ADMINISTRABLE);
  const ownerOnlyUserScopeParam = createUserScopeParam(USER_SCOPE_POLICY.OWNER_ONLY);

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

  const serviceBotAccess = createServiceBotAccess({ getBot: () => bot });
  const runtimeConfigService = createRuntimeConfigService({
    startupContext,
    readWorkspaceConfigParams,
    globalConfigBuilder: configBuilder,
    BotManager,
    createSessionRuntime(config, dependencies) {
      const configuredRoot = resolveWorkspaceRootPath({
        configuredRoot: config.workspaceRoot,
        serviceDir,
      });
      if (configuredRoot !== workspaceRoot) {
        throw new Error(
          "Configured workspace root differs from the service workspace storage lease",
        );
      }
      return createConfiguredSessionRuntime(
        { ...config, workspaceRoot },
        { ...dependencies, assertWorkspaceStorageReady },
      );
    },
    now,
    setGlobalConfigRaw: (nextGlobalConfigRaw) => {
      globalConfigRaw = nextGlobalConfigRaw;
    },
    setGlobalConfig: (nextGlobalConfig) => {
      globalConfig = nextGlobalConfig;
    },
    getBot: () => bot,
    withBotRetirement: serviceBotAccess.withRetirement,
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
    workspaceRootPath,
    getBot: () => bot,
    serviceBotAccess,
    getGlobalConfig: () => globalConfig,
    readSessionUserIds,
    openVSCodeService,
    buildHttpModuleDependencies: () => ({
      pluginRootDir: startupContext.paths.pluginRootDir,
      bot: serviceBotAccess,
      runBotOperation: serviceBotAccess.runOperation,
      openVSCodeService,
      globalConfigProvider: () => globalConfig,
      issueApiKey,
      issueResourceAccess,
      readWorkspaceUsers,
      readWorkspaceUsersConfig,
      writeWorkspaceUsersConfig,
      normalizeWorkspaceUsersConfig,
      requireSuperAdmin,
      requireApiKey,
      administrableUserScopeParam,
      ownerOnlyUserScopeParam,
      resolveAuthByApiKey,
      resolveConfigParamScope,
      readScopedConfigParams,
      writeScopedConfigParams,
      buildScopedConfigParamsResponse,
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
