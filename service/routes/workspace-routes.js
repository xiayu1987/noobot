/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "../system-core/tracking/console/logger.js";
import path from "node:path";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { registerFileCrudRoutes } from "./file-crud-routes.js";
import { buildWorkspaceTree } from "../services/workspace-tree-service.js";
import { buildDirectoryArchiveFile } from "../services/zip-service.js";

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
  // ── User-level workspace routes (unchanged) ──

  app.get("/internal/workspace/tree/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const basePath = await workspaceService.ensureUserWorkspace(userId);
      const tree = await buildWorkspaceTree(basePath);
      res.json({ ok: true, userId, root: basePath, tree });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post("/internal/workspace/reset/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
      const basePath = await workspaceService.resetUserWorkspace(userId, { sections });
      res.json({
        ok: true,
        userId,
        root: basePath,
        sections,
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.resetWorkspaceFailed", req.locale),
      });
    }
  });

  app.post("/internal/workspace/sync/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const basePath = await workspaceService.syncUserWorkspace(userId);
      res.json({ ok: true, userId, root: basePath });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.syncWorkspaceFailed", req.locale),
      });
    }
  });

  app.get("/internal/workspace/file/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const basePath = await workspaceService.ensureUserWorkspace(userId);
      const { safeJoin } = await import("../system-core/utils/fs-safe.js");
      const absolutePath = safeJoin(basePath, relativePath);
      try {
        await access(absolutePath);
      } catch (error) {
        logError("[workspace-routes] file download access check failed", {
          workspaceId,
          relativePath,
          absolutePath,
          error: error?.message || String(error),
        });
        throw new Error(translateText("common.fileNotFound", req.locale));
      }
      const { stat, readFile } = await import("node:fs/promises");
      const fileStats = await stat(absolutePath);
      if (!fileStats.isFile()) throw new Error(translateText("common.pathIsNotFile", req.locale));
      const contentBuffer = await readFile(absolutePath);
      const isText = !contentBuffer.includes(0);
      const content = isText ? contentBuffer.toString("utf8") : "";
      res.json({ ok: true, path: relativePath, isText, size: fileStats.size, content });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.put("/internal/workspace/file/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const relativePath = String(req.body?.path || "");
      const content = String(req.body?.content || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const basePath = await workspaceService.ensureUserWorkspace(userId);
      const { safeJoin } = await import("../system-core/utils/fs-safe.js");
      const absolutePath = safeJoin(basePath, relativePath);
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      res.json({ ok: true, path: relativePath });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.get("/internal/workspace/download/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const basePath = await workspaceService.ensureUserWorkspace(userId);
      const { safeJoin } = await import("../system-core/utils/fs-safe.js");
      const absolutePath = safeJoin(basePath, relativePath);
      try {
        await access(absolutePath);
      } catch (error) {
        logError("[workspace-routes] file download access check failed", {
          workspaceId,
          relativePath,
          absolutePath,
          error: error?.message || String(error),
        });
        throw new Error(translateText("common.fileNotFound", req.locale));
      }
      const { stat } = await import("node:fs/promises");
      const fileStats = await stat(absolutePath);
      if (fileStats.isFile()) {
        res.download(absolutePath, path.basename(relativePath));
        return;
      }
      if (!fileStats.isDirectory()) throw new Error(translateText("common.pathIsNotFile", req.locale));
      const archiveMeta = await buildDirectoryArchiveFile({
        absoluteDirectoryPath: absolutePath,
        archiveName: path.basename(relativePath),
      });
      const { rm } = await import("node:fs/promises");
      const cleanupTemp = async () => {
        await rm(archiveMeta.temporaryDirectory, { recursive: true, force: true }).catch(
          () => {},
        );
      };
      res.on("close", cleanupTemp);
      res.on("finish", cleanupTemp);
      res.download(archiveMeta.archiveFilePath, archiveMeta.archiveFileName);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // ── Admin-level workspace-all routes (sync, reset, file CRUD) ──

  app.post("/internal/admin/workspace-all/sync", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
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
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.syncAllWorkspaceFailed", req.locale),
      });
    }
  });

  app.post("/internal/admin/workspace-all/reset", requireApiKey, requireSuperAdmin, async (req, res) => {
    try {
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
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.resetAllWorkspaceFailed", req.locale),
      });
    }
  });

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
