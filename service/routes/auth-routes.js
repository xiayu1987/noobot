/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveBuiltinScenarios } from "#agent/config";
import { getProviders, resolveDefaultModelSpec } from "#agent/model";
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

function isConversationProvider(provider = {}) {
  if (!provider || typeof provider !== "object") return false;
  return provider?.enabled === true && provider?.used_for_conversation === true;
}

function buildClientModelOption(alias = "", provider = {}) {
  const normalizedAlias = String(alias || provider?.alias || "").trim();
  const model = String(provider?.model || "").trim();
  const name = String(provider?.name || provider?.label || normalizedAlias || model).trim();
  const value = normalizedAlias || model;
  if (!value) return null;
  return {
    value,
    alias: normalizedAlias || value,
    key: normalizedAlias || value,
    label: name || value,
    name: name || value,
    model,
    description: String(provider?.description || "").trim(),
  };
}

function buildClientEnabledModels(globalConfig = {}, userConfig = {}) {
  const providers = getProviders(globalConfig, userConfig);
  return Object.entries(providers)
    .filter(([, provider]) => isConversationProvider(provider))
    .map(([alias, provider]) => buildClientModelOption(alias, provider))
    .filter(Boolean);
}

function buildClientDefaultModel(globalConfig = {}, userConfig = {}, enabledModels = []) {
  const safeEnabledModels = Array.isArray(enabledModels) ? enabledModels : [];
  const enabledModelKeySet = new Set(
    safeEnabledModels
      .flatMap((modelItem) => [modelItem?.value, modelItem?.alias, modelItem?.key, modelItem?.model])
      .map((modelKey) => String(modelKey || "").trim())
      .filter(Boolean),
  );
  const defaultSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  const defaultOption = isConversationProvider(defaultSpec)
    ? buildClientModelOption(defaultSpec?.alias, defaultSpec)
    : null;
  const defaultKeys = [
    defaultOption?.value,
    defaultOption?.alias,
    defaultOption?.key,
    defaultOption?.model,
  ]
    .map((modelKey) => String(modelKey || "").trim())
    .filter(Boolean);
  if (defaultOption && defaultKeys.some((modelKey) => enabledModelKeySet.has(modelKey))) {
    return defaultOption;
  }
  return safeEnabledModels[0] || null;
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
        const superAdminScenarios = resolveBuiltinScenarios(
          globalConfig?.scenarios,
          loadedSuperAdminConfig?.scenarios || {},
          { locale: req.locale },
        );
        const superAdminPlugins = resolveMergedPlugins(
          globalConfig?.plugins,
          loadedSuperAdminConfig?.plugins,
        );
        const superAdminEnabledModels = buildClientEnabledModels(
          globalConfig,
          loadedSuperAdminConfig,
        );
        const superAdminDefaultModel = buildClientDefaultModel(
          globalConfig,
          loadedSuperAdminConfig,
          superAdminEnabledModels,
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
          enabledModels: superAdminEnabledModels,
          defaultModel: superAdminDefaultModel,
          defaultModelAlias: String(superAdminDefaultModel?.alias || superAdminDefaultModel?.value || "").trim(),
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
        { locale: req.locale },
      );
      const mergedPlugins = resolveMergedPlugins(
        globalConfig?.plugins,
        loadedUserConfig?.plugins,
      );
      const enabledModels = buildClientEnabledModels(globalConfig, loadedUserConfig);
      const defaultModel = buildClientDefaultModel(globalConfig, loadedUserConfig, enabledModels);
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
        enabledModels,
        defaultModel,
        defaultModelAlias: String(defaultModel?.alias || defaultModel?.value || "").trim(),
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
