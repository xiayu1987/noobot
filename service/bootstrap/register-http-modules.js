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
import { createPluginServicePorts } from "../services/plugin-service-ports.js";
import { rateLimit } from "express-rate-limit";
import { createHttpAdmissionOptions } from "../security/http-admission.js";

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
    getConnectorChannelStore,
    getConnectorRegistry,
    workspaceRootPath,
    handleChat,
    translateText,
    pluginRootDir,
  } = {},
) {
  app.use(rateLimit(createHttpAdmissionOptions({ resolveAuthByApiKey })));

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
    if (
      req.path === "/health" ||
      req.path === "/internal/connect" ||
      req.path === "/ide" ||
      req.path.startsWith("/ide/")
    ) {
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
    getConnectorRegistry,
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

  const servicePluginHost = createServicePluginHost({ pluginRootDir });
  await servicePluginHost.registerServiceRoutes(app, {
    translateText,
    ports: createPluginServicePorts({ bot, translateText }),
  });

  registerSessionRoutes(app, {
    bot,
    handleChat,
    translateText,
    pluginHost: servicePluginHost,
  });
}
