/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { registerAuthRoutes } from "../routes/auth-routes.js";
import { registerConfigAndTemplateRoutes } from "../routes/config-template-routes.js";
import { registerConnectorRoutes } from "../routes/connectors-routes.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { registerWorkspaceRoutes } from "../routes/workspace-routes.js";
import { registerIdeRoutes } from "../routes/ide-routes.js";
import { createServicePluginHost } from "../services/service-plugin-host.js";

export async function registerHttpModules(
  app,
  {
    bot,
    openVSCodeService,
    globalConfigProvider,
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
  } = {},
) {
  const workspaceService = {
    ensureUserWorkspace: (...args) => bot?.ensureUserWorkspace?.(...args),
    resetUserWorkspace: (...args) => bot?.resetUserWorkspace?.(...args),
    syncUserWorkspace: (...args) => bot?.syncUserWorkspace?.(...args),
    getWorkspacePath: (...args) => bot?.getWorkspacePath?.(...args),
  };

  const loadUserConfigForUser = async (userId = "") => {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return {};
    if (typeof bot?.getWorkspacePath !== "function") return {};
    if (typeof bot?.loadUserConfig !== "function") return {};
    const workspacePath = bot.getWorkspacePath(normalizedUserId);
    return (await bot.loadUserConfig(workspacePath)) || {};
  };

  registerAuthRoutes(app, {
    workspaceService,
    loadUserConfigForUser,
    globalConfigProvider,
    issueApiKey,
    readWorkspaceUsers,
    readWorkspaceUsersConfig,
    writeWorkspaceUsersConfig,
    normalizeWorkspaceUsersConfig,
    requireApiKey,
    requireSuperAdmin,
    translateText,
  });

  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/internal/connect" || req.path === "/ide" || req.path.startsWith("/ide/")) {
      next();
      return;
    }
    requireApiKey(req, res, next);
  });

  registerConfigAndTemplateRoutes(app, {
    requireApiKey,
    requireSuperAdmin,
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
    translateText,
  });

  registerConnectorRoutes(app, {
    bot,
    getConnectorChannelStore,
    getConnectorHistoryStore,
    normalizeSelectedConnectors,
    translateText,
  });

  registerIdeRoutes(app, {
    openVSCodeService,
    readWorkspaceUsers,
    translateText,
  });

  registerWorkspaceRoutes(app, {
    workspaceService,
    workspaceRootPath,
    requireApiKey,
    requireSuperAdmin,
    globalConfig: globalConfigProvider(),
    translateText,
  });

  registerSessionRoutes(app, {
    bot,
    handleChat,
    getConnectorChannelStore,
    getConnectorHistoryStore,
    translateText,
  });

  await createServicePluginHost().registerServiceRoutes(app, {
    bot,
    translateText,
  });
}
