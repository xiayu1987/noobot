/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

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
        const apiKey = issueApiKey({ userId, role: "super_admin" });
        res.json({ ok: true, role: "super_admin", userId, apiKey });
        return;
      }

      const users = await readWorkspaceUsers();
      const matchedUser = users.find(
        (userItem) => userItem.userId === userId && userItem.connectCode === connectCode,
      );
      if (!matchedUser) throw new Error(translateText("connect.codeVerifyFailed", req.locale));

      await bot.ensureUserWorkspace(userId);
      const apiKey = issueApiKey({ userId, role: "user" });
      res.json({ ok: true, role: "user", userId, apiKey });
    } catch (error) {
      res
        .status(400)
        .json({ ok: false, error: error.message || translateText("connect.failed", req.locale) });
    }
  });

  app.get("/internal/admin/users", requireSuperAdmin, async (req, res) => {
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

  app.put("/internal/admin/users", requireSuperAdmin, async (req, res) => {
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
