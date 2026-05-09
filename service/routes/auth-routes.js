/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeScenarioDefinitions(definitionsInput = {}) {
  const sourceDefinitions = isPlainObject(definitionsInput) ? definitionsInput : {};
  const normalizedDefinitions = {};
  for (const [scenarioKey, scenarioValue] of Object.entries(sourceDefinitions)) {
    const normalizedScenarioKey = String(scenarioKey || "").trim();
    if (!normalizedScenarioKey) continue;
    const sourceScenario = isPlainObject(scenarioValue) ? scenarioValue : {};
    const normalizedTools = Array.isArray(sourceScenario?.tools)
      ? sourceScenario.tools
          .map((toolName) => String(toolName || "").trim())
          .filter(Boolean)
      : [];
    const normalizedContext = Array.isArray(sourceScenario?.context)
      ? sourceScenario.context
          .map((contextKey) => String(contextKey || "").trim())
          .filter(Boolean)
      : [];
    normalizedDefinitions[normalizedScenarioKey] = {
      ...sourceScenario,
      name: String(sourceScenario?.name || "").trim(),
      model: String(sourceScenario?.model || "").trim(),
      tools: normalizedTools,
      context: normalizedContext,
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
    bot,
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
  app.post("/internal/connect", async (req, res) => {
    try {
      const userId = String(req.body?.userId || "").trim();
      const connectCode = String(req.body?.connectCode || "").trim();
      if (!userId || !connectCode) {
        throw new Error(translateText("connect.userIdConnectCodeRequired", req.locale));
      }

      const globalConfig =
        typeof globalConfigProvider === "function" ? globalConfigProvider() : {};
      const superAdmin = globalConfig?.superAdmin || {};
      const superAdminUserId = String(superAdmin?.userId || "").trim();
      const superAdminCode = String(superAdmin?.connectCode || "").trim();
      if (
        superAdminUserId &&
        superAdminCode &&
        userId === superAdminUserId &&
        connectCode === superAdminCode
      ) {
        await bot.ensureUserWorkspace(userId);
        const superAdminScenarios = resolveMergedScenarios(globalConfig?.scenarios, {});
        const apiKey = issueApiKey({ userId, role: "super_admin" });
        res.json({
          ok: true,
          role: "super_admin",
          userId,
          apiKey,
          permissions: buildClientPermissions("super_admin"),
          scenarios: superAdminScenarios,
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

      await bot.ensureUserWorkspace(userId);
      let userScenarios = {};
      try {
        const userWorkspacePath =
          typeof bot.getWorkspacePath === "function"
            ? bot.getWorkspacePath(userId)
            : "";
        const loadedUserConfig =
          userWorkspacePath && typeof bot.loadUserConfig === "function"
            ? await bot.loadUserConfig(userWorkspacePath)
            : {};
        userScenarios =
          loadedUserConfig && typeof loadedUserConfig === "object"
            ? loadedUserConfig.scenarios || {}
            : {};
      } catch {
        userScenarios = {};
      }
      const mergedScenarios = resolveMergedScenarios(
        globalConfig?.scenarios,
        userScenarios,
      );
      const apiKey = issueApiKey({ userId, role: "user" });
      res.json({
        ok: true,
        role: "user",
        userId,
        apiKey,
        permissions: buildClientPermissions("user"),
        scenarios: mergedScenarios,
      });
    } catch (error) {
      res
        .status(400)
        .json({ ok: false, error: error.message || translateText("connect.failed", req.locale) });
    }
  });

  app.get("/internal/admin/users", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
      const payload = await readWorkspaceUsersConfig({ createIfMissing: true });
      res.json({ ok: true, ...payload });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.readUsersFailed", req.locale),
      });
    }
  });

  app.put("/internal/admin/users", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
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
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error.message || translateText("common.saveUsersFailed", req.locale),
      });
    }
  });
}
