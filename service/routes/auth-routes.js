/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveBuiltinScenarios } from "#agent/config";
import { logError } from "#agent/tracking";
import { withJsonError } from "./route-wrapper.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function buildClientPermissions(role = "user", { canUseIDE = false } = {}) {
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
    canUseIDE: isSuperAdmin || canUseIDE === true,
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
        const superAdminScenarios = resolveBuiltinScenarios(globalConfig?.scenarios, {});
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
          permissions: buildClientPermissions("super_admin", { canUseIDE: true }),
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
      const mergedScenarios = resolveBuiltinScenarios(
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
        permissions: buildClientPermissions("user", {
          canUseIDE: matchedUser?.allowIDE === true,
        }),
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
