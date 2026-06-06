/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "#agent/tracking";
import path from "node:path";
import { access, mkdir, readdir } from "node:fs/promises";
import { registerFileCrudRoutes } from "./file-crud-routes.js";
import { buildWorkspaceTree } from "../services/workspace-tree-service.js";
import { buildDirectoryArchiveFile } from "../services/zip-service.js";
import { createJsonRouteWrapper } from "./route-wrapper.js";

const RESERVED_WORKSPACE_ROOT_DIRS = new Set([
  "memory",
  "runtime",
  "service",
  "services",
  "skill",
  "skills",
]);

async function listWorkspaceUserDirs(root = "", globalConfig = {}) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  const userDirs = [];
  for (const entry of entries) {
    const userId = String(entry?.name || "").trim();
    if (!entry.isDirectory() || !userId || userId.startsWith(".")) continue;
    if (RESERVED_WORKSPACE_ROOT_DIRS.has(userId)) continue;
    try {
      await access(path.join(root, userId, "config.json"));
      userDirs.push(userId);
    } catch (error) {
      logError("[workspace-routes] listWorkspaceUserDirs config.json access failed", {
        root,
        userId,
        error: error?.message || String(error),
      });
      // A user workspace must have config.json. Skip stray directories.
    }
  }
  const superAdminUserId = String(globalConfig?.superAdmin?.userId || "").trim();
  if (superAdminUserId && !userDirs.includes(superAdminUserId)) {
    userDirs.push(superAdminUserId);
  }
  return userDirs;
}

export function registerWorkspaceRoutes(
  app,
  {
    workspaceService,
    workspaceRootPath,
    requireApiKey,
    requireSuperAdmin,
    globalConfig,
    translateText,
  } = {},
) {
  const jsonRoute = createJsonRouteWrapper({ translateText });

  // ── User-level workspace routes (unchanged) ──

  app.post(
    "/internal/workspace/reset/:userId",
    jsonRoute(
      async (req, res) => {
      const { userId } = req.params;
      const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
      const basePath = await workspaceService.resetUserWorkspace(userId, { sections });
      res.json({
        ok: true,
        userId,
        root: basePath,
        sections,
      });
      },
      { fallbackErrorKey: "common.resetWorkspaceFailed" },
    ),
  );

  app.post(
    "/internal/workspace/sync/:userId",
    jsonRoute(
      async (req, res) => {
      const { userId } = req.params;
      const basePath = await workspaceService.syncUserWorkspace(userId);
      res.json({ ok: true, userId, root: basePath });
      },
      { fallbackErrorKey: "common.syncWorkspaceFailed" },
    ),
  );

  registerFileCrudRoutes(app, {
    routePrefix: "/internal/workspace/:userId",
    resolveRootPath: (req) =>
      workspaceService.ensureUserWorkspace(String(req?.params?.userId || "").trim()),
    buildWorkspaceTree,
    buildDirectoryArchiveFile,
    translateText,
    i18nKeys: {
      treeFailed: "",
      readFailed: "",
      saveFailed: "",
      downloadFailed: "",
    },
    responseBuilders: {
      tree: ({ req, root, tree }) => ({
        ok: true,
        userId: String(req?.params?.userId || "").trim(),
        root,
        tree,
      }),
    },
  });

  // ── Admin-level workspace-all routes (sync, reset, file CRUD) ──

  app.post(
    "/internal/admin/workspace-all/sync",
    requireApiKey,
    requireSuperAdmin,
    jsonRoute(
      async (req, res) => {
      const root = workspaceRootPath();
      const userDirs = await listWorkspaceUserDirs(root, globalConfig);
      const syncedUsers = [];
      for (const userId of userDirs) {
        try {
          await workspaceService.syncUserWorkspace(userId);
          syncedUsers.push(userId);
        } catch (error) {
          logError("[workspace-routes] syncUserWorkspace failed in sync-all loop", {
            userId,
            error: error?.message || String(error),
          });
          // ignore single-user sync error, continue syncing others
        }
      }
      res.json({
        ok: true,
        syncedUsers,
        total: userDirs.length,
        success: syncedUsers.length,
      });
      },
      { fallbackErrorKey: "common.syncAllWorkspaceFailed" },
    ),
  );

  app.post(
    "/internal/admin/workspace-all/reset",
    requireApiKey,
    requireSuperAdmin,
    jsonRoute(
      async (req, res) => {
      const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
      const root = workspaceRootPath();
      const userDirs = await listWorkspaceUserDirs(root, globalConfig);
      const resetUsers = [];
      for (const userId of userDirs) {
        try {
          await workspaceService.resetUserWorkspace(userId, { sections });
          resetUsers.push(userId);
        } catch (error) {
          logError("[workspace-routes] resetUserWorkspace failed in reset-all loop", {
            userId,
            sections: JSON.stringify(sections),
            error: error?.message || String(error),
          });
          // ignore single-user failure and continue
        }
      }
      res.json({
        ok: true,
        resetUsers,
        total: userDirs.length,
        success: resetUsers.length,
        sections,
      });
      },
      { fallbackErrorKey: "common.resetAllWorkspaceFailed" },
    ),
  );

  // ── Admin file CRUD routes via factory ──

  registerFileCrudRoutes(app, {
    routePrefix: "/internal/admin/workspace-all",
    resolveRootPath: workspaceRootPath,
    middleware: [requireApiKey, requireSuperAdmin],
    buildWorkspaceTree,
    buildDirectoryArchiveFile,
    translateText,
  });
}
