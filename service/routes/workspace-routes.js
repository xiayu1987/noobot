/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { safeJoin } from "../system-core/utils/fs-safe.js";
import { buildWorkspaceTree } from "../services/workspace-tree-service.js";
import { buildDirectoryArchiveFile } from "../services/zip-service.js";

export function registerWorkspaceRoutes(
  app,
  {
    bot,
    workspaceRootPath,
    requireSuperAdmin,
    globalConfig,
    translateText,
  } = {},
) {
  app.get("/internal/workspace/tree/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const basePath = await bot.ensureUserWorkspace(userId);
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
      const basePath = await bot.resetUserWorkspace(userId, { sections });
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
      const basePath = await bot.syncUserWorkspace(userId);
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

  app.post("/internal/admin/workspace-all/sync", requireSuperAdmin, async (req, res) => {
    try {
      const root = workspaceRootPath();
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const userDirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => String(entry.name || "").trim())
        .filter(Boolean);
      const superAdminUserId = String(globalConfig?.superAdmin?.userId || "").trim();
      if (superAdminUserId && !userDirs.includes(superAdminUserId)) {
        userDirs.push(superAdminUserId);
      }
      const syncedUsers = [];
      for (const userId of userDirs) {
        try {
          await bot.syncUserWorkspace(userId);
          syncedUsers.push(userId);
        } catch {
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

  app.post("/internal/admin/workspace-all/reset", requireSuperAdmin, async (req, res) => {
    try {
      const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
      const root = workspaceRootPath();
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const userDirs = entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => String(entry.name || "").trim())
        .filter(Boolean);
      const superAdminUserId = String(globalConfig?.superAdmin?.userId || "").trim();
      if (superAdminUserId && !userDirs.includes(superAdminUserId)) {
        userDirs.push(superAdminUserId);
      }
      const resetUsers = [];
      for (const userId of userDirs) {
        try {
          await bot.resetUserWorkspace(userId, { sections });
          resetUsers.push(userId);
        } catch {
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

  app.get("/internal/workspace/file/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const basePath = await bot.ensureUserWorkspace(userId);
      const absolutePath = safeJoin(basePath, relativePath);
      try {
        await access(absolutePath);
      } catch {
        throw new Error(translateText("common.fileNotFound", req.locale));
      }
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
      const basePath = await bot.ensureUserWorkspace(userId);
      const absolutePath = safeJoin(basePath, relativePath);
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
      const basePath = await bot.ensureUserWorkspace(userId);
      const absolutePath = safeJoin(basePath, relativePath);
      try {
        await access(absolutePath);
      } catch {
        throw new Error(translateText("common.fileNotFound", req.locale));
      }
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

  app.get("/internal/admin/workspace-all/tree", requireSuperAdmin, async (req, res) => {
    try {
      const root = workspaceRootPath();
      await mkdir(root, { recursive: true });
      const tree = await buildWorkspaceTree(root);
      res.json({ ok: true, root, tree });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.loadWorkspaceTreeFailed", req.locale),
      });
    }
  });

  app.get("/internal/admin/workspace-all/file", requireSuperAdmin, async (req, res) => {
    try {
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = workspaceRootPath();
      const absolutePath = safeJoin(root, relativePath);
      await access(absolutePath);
      const fileStats = await stat(absolutePath);
      if (!fileStats.isFile()) throw new Error(translateText("common.pathIsNotFile", req.locale));
      const contentBuffer = await readFile(absolutePath);
      const isText = !contentBuffer.includes(0);
      const content = isText ? contentBuffer.toString("utf8") : "";
      res.json({ ok: true, path: relativePath, isText, size: fileStats.size, content });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.readWorkspaceFileFailed", req.locale),
      });
    }
  });

  app.put("/internal/admin/workspace-all/file", requireSuperAdmin, async (req, res) => {
    try {
      const relativePath = String(req.body?.path || "");
      const content = String(req.body?.content || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = workspaceRootPath();
      const absolutePath = safeJoin(root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      res.json({ ok: true, path: relativePath });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.saveWorkspaceFileFailed", req.locale),
      });
    }
  });

  app.get("/internal/admin/workspace-all/download", requireSuperAdmin, async (req, res) => {
    try {
      const relativePath = String(req.query.path || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = workspaceRootPath();
      const absolutePath = safeJoin(root, relativePath);
      await access(absolutePath);
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
      const cleanupTemp = async () => {
        await rm(archiveMeta.temporaryDirectory, { recursive: true, force: true }).catch(
          () => {},
        );
      };
      res.on("close", cleanupTemp);
      res.on("finish", cleanupTemp);
      res.download(archiveMeta.archiveFilePath, archiveMeta.archiveFileName);
    } catch (error) {
      res.status(400).json({
        ok: false,
        error:
          error.message ||
          translateText("common.downloadWorkspaceFileFailed", req.locale),
      });
    }
  });
}
