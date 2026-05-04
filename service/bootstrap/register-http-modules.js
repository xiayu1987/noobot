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

export function registerHttpModules(
  app,
  {
    bot,
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
  registerAuthRoutes(app, {
    bot,
    globalConfigProvider,
    issueApiKey,
    readWorkspaceUsers,
    readWorkspaceUsersConfig,
    writeWorkspaceUsersConfig,
    normalizeWorkspaceUsersConfig,
    requireSuperAdmin,
    translateText,
  });

  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/internal/connect") {
      next();
      return;
    }
    requireApiKey(req, res, next);
  });

  registerConfigAndTemplateRoutes(app, {
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

  registerWorkspaceRoutes(app, {
    bot,
    workspaceRootPath,
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
}
