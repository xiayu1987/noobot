/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "#agent/tracking";
import { withJsonError } from "./route-wrapper.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeScenarioDefinitions(definitionsInput = {}) {
  const sourceDefinitions = isPlainObject(definitionsInput) ? definitionsInput : {};
  const normalizedDefinitions = {};
  const normalizeStringArray = (input = []) =>
    Array.isArray(input)
      ? input
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];
  for (const [scenarioKey, scenarioValue] of Object.entries(sourceDefinitions)) {
    const normalizedScenarioKey = String(scenarioKey || "").trim();
    if (!normalizedScenarioKey) continue;
    const sourceScenario = isPlainObject(scenarioValue) ? scenarioValue : {};
    const normalizedTools = normalizeStringArray(sourceScenario?.tools);
    const normalizedContext = normalizeStringArray(sourceScenario?.context);
    const normalizedServices = normalizeStringArray(sourceScenario?.services);
    const normalizedMcpServers = normalizeStringArray(
      sourceScenario?.mcpServers ?? sourceScenario?.mcp_servers,
    );
    normalizedDefinitions[normalizedScenarioKey] = {
      ...sourceScenario,
      name: String(sourceScenario?.name || "").trim(),
      description: String(sourceScenario?.description || "").trim(),
      model: String(sourceScenario?.model || "").trim(),
      tools: normalizedTools,
      context: normalizedContext,
      services: normalizedServices,
      mcpServers: normalizedMcpServers,
    };
  }
  return normalizedDefinitions;
}

function resolveMergedScenarios(globalScenarios = {}, userScenarios = {}) {
  const globalSource = isPlainObject(globalScenarios) ? globalScenarios : {};
  const userSource = isPlainObject(userScenarios) ? userScenarios : {};
  const globalDefinitions = normalizeScenarioDefinitions(globalSource?.definitions);
  const userDefinitions = normalizeScenarioDefinitions(userSource?.definitions);
  const mergedDefinitions = {
    ...globalDefinitions,
    ...userDefinitions,
  };
  const userDefaultScenario = String(userSource?.default || "").trim();
  const globalDefaultScenario = String(globalSource?.default || "").trim();
  const resolvedDefaultScenario = userDefaultScenario || globalDefaultScenario || "";
  return {
    default: resolvedDefaultScenario,
    definitions: mergedDefinitions,
  };
}

function normalizePluginMode(value = "off") {
  return String(value || "").trim().toLowerCase() === "on" ? "on" : "off";
}

function resolveMergedPlugins(globalPlugins = {}, userPlugins = {}) {
  const globalSource = isPlainObject(globalPlugins) ? globalPlugins : {};
  const userSource = isPlainObject(userPlugins) ? userPlugins : {};
  const keys = new Set([
    ...Object.keys(globalSource),
    ...Object.keys(userSource),
  ]);
  const mergedPlugins = {};
  for (const key of keys) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) continue;
    const globalItem = isPlainObject(globalSource?.[normalizedKey])
      ? globalSource[normalizedKey]
      : {};
    const userItem = isPlainObject(userSource?.[normalizedKey])
      ? userSource[normalizedKey]
      : {};
    const mergedItem = {
      ...globalItem,
      ...userItem,
    };
    mergedPlugins[normalizedKey] = {
      ...mergedItem,
      enabled: mergedItem?.enabled === true,
      mode: normalizePluginMode(mergedItem?.mode),
    };
  }
  return mergedPlugins;
}

function buildClientPermissions(role = "user") {
  const normalizedRole = String(role || "user").trim() || "user";
  const isSuperAdmin = normalizedRole === "super_admin";
  return {
    role: normalizedRole,
    canChat: true,
    canUseAgentProxy: true,
    canAccessWorkspace: true,
    canAccessAdmin: isSuperAdmin,
    canManageUsers: isSuperAdmin,
    canManageTemplate: isSuperAdmin,
    canManageSystemConfigParams: isSuperAdmin,
  };
}

export function registerAuthRoutes(
  app,
  {
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
  } = {},
) {
  app.post(
    "/internal/connect",
    withJsonError(
      async (req, res) => {
      const userId = String(req.body?.userId || "").trim();
      const connectCode = String(req.body?.connectCode || "").trim();
      if (!userId || !connectCode) {
        throw new Error(translateText("connect.userIdConnectCodeRequired", req.locale));
      }

      const globalConfig =
        typeof globalConfigProvider === "function" ? globalConfigProvider() : {};
      const loadUserConfigSafe = async (targetUserId = "") => {
        try {
          return typeof loadUserConfigForUser === "function"
            ? (await loadUserConfigForUser(targetUserId)) || {}
            : {};
        } catch (error) {
          logError("[auth-routes] loadUserConfig failed", {
            userId: targetUserId,
            error: error?.message || String(error),
          });
          return {};
        }
      };
      const superAdmin = globalConfig?.superAdmin || {};
      const superAdminUserId = String(superAdmin?.userId || "").trim();
      const superAdminCode = String(superAdmin?.connectCode || "").trim();
      if (
        superAdminUserId &&
        superAdminCode &&
        userId === superAdminUserId &&
        connectCode === superAdminCode
      ) {
        await workspaceService.ensureUserWorkspace(userId);
        const loadedSuperAdminConfig = await loadUserConfigSafe(userId);
        const superAdminScenarios = resolveMergedScenarios(globalConfig?.scenarios, {});
        const superAdminPlugins = resolveMergedPlugins(
          globalConfig?.plugins,
          loadedSuperAdminConfig?.plugins,
        );
        const apiKey = issueApiKey({ userId, role: "super_admin" });
        res.json({
          ok: true,
          role: "super_admin",
          userId,
          apiKey,
          permissions: buildClientPermissions("super_admin"),
          scenarios: superAdminScenarios,
          plugins: superAdminPlugins,
        });
        return;
      }
      if (superAdminUserId && userId === superAdminUserId) {
        throw new Error(translateText("connect.codeVerifyFailed", req.locale));
      }

      const users = await readWorkspaceUsers();
      const matchedUser = users.find(
        (userItem) => userItem.userId === userId && userItem.connectCode === connectCode,
      );
      if (!matchedUser) throw new Error(translateText("connect.codeVerifyFailed", req.locale));

      await workspaceService.ensureUserWorkspace(userId);
      const loadedUserConfig = await loadUserConfigSafe(userId);
      const userScenarios =
        loadedUserConfig && typeof loadedUserConfig === "object"
          ? loadedUserConfig.scenarios || {}
          : {};
      const mergedScenarios = resolveMergedScenarios(
        globalConfig?.scenarios,
        userScenarios,
      );
      const mergedPlugins = resolveMergedPlugins(
        globalConfig?.plugins,
        loadedUserConfig?.plugins,
      );
      const apiKey = issueApiKey({ userId, role: "user" });
      res.json({
        ok: true,
        role: "user",
        userId,
        apiKey,
        permissions: buildClientPermissions("user"),
        scenarios: mergedScenarios,
        plugins: mergedPlugins,
      });
      },
      { fallbackErrorKey: "connect.failed", translateText },
    ),
  );

  app.get(
    "/internal/admin/users",
    requireApiKey,
    requireSuperAdmin,
    withJsonError(
      async (req, res) => {
      const payload = await readWorkspaceUsersConfig({ createIfMissing: true });
      res.json({ ok: true, ...payload });
      },
      { fallbackErrorKey: "common.readUsersFailed", translateText },
    ),
  );

  app.put(
    "/internal/admin/users",
    requireApiKey,
    requireSuperAdmin,
    withJsonError(
      async (req, res) => {
      const normalized = normalizeWorkspaceUsersConfig(req.body || {});
      if (!normalized.users.length) {
        throw new Error(translateText("common.atLeastOneUserRequired", req.locale));
      }
      const duplicateUserId = normalized.users.find(
        (userItem, index) =>
          normalized.users.findIndex(
            (otherUserItem) => otherUserItem.userId === userItem.userId,
          ) !== index,
      );
      if (duplicateUserId) {
        throw new Error(
          translateText("common.duplicateUserId", req.locale, {
            userId: duplicateUserId.userId,
          }),
        );
      }
      const payload = await writeWorkspaceUsersConfig(normalized);
      res.json({ ok: true, ...payload });
      },
      { fallbackErrorKey: "common.saveUsersFailed", translateText },
    ),
  );
}
