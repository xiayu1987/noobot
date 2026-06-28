/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "#agent/tracking";
import path from "node:path";
import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
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

  const maskHostPath = (pathValue = "") => {
    const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 2) return normalized;
    return `${parts[0]}/.../${parts.at(-1)}`;
  };

  const logHostFileAccess = (req, event, payload = {}) => {
    const traceId = String(req?.headers?.["x-noobot-file-trace-id"] || "").trim();
    if (!traceId) return;
    try {
      console.info("[noobot:file-access]", {
        layer: "service.hostFile",
        event,
        traceId,
        channel: "backend-host-api",
        ...payload,
      });
    } catch {}
  };

  const assertHostAccessAllowed = (req) => {
    const isSandbox = String(req?.query?.isSandbox || "").trim().toLowerCase();
    if (isSandbox !== "false") {
      const error = new Error("Host file access requires non-sandbox attachment metadata.");
      error.status = 403;
      error.code = "host_access_requires_non_sandbox";
      throw error;
    }
  };

  const resolveHostFilePath = async (req) => {
    const hostPath = String(req?.query?.path || "").trim();
    if (!hostPath) {
      const error = new Error(translateText("common.pathRequired", req.locale));
      error.code = "missing_path";
      throw error;
    }
    if (!path.isAbsolute(hostPath)) {
      const error = new Error("Host file path must be absolute.");
      error.status = 400;
      error.code = "not_absolute";
      throw error;
    }
    const fileStats = await stat(hostPath);
    if (!fileStats.isFile()) {
      const error = new Error(translateText("common.pathIsNotFile", req.locale));
      error.status = 400;
      error.code = "not_file";
      throw error;
    }
    return { hostPath, fileStats };
  };

  // ── User-level workspace routes (unchanged) ──

  app.get(
    "/internal/host-file/file",
    jsonRoute(
      async (req, res) => {
        const requestedPath = String(req?.query?.path || "").trim();
        logHostFileAccess(req, "file.request", {
          hasPath: Boolean(requestedPath),
          hostPath: maskHostPath(requestedPath),
          isSandbox: String(req?.query?.isSandbox || ""),
        });
        assertHostAccessAllowed(req);
        const { hostPath, fileStats } = await resolveHostFilePath(req);
        const contentBuffer = await readFile(hostPath);
        const isText = !contentBuffer.includes(0);
        logHostFileAccess(req, "file.response", {
          hostPath: maskHostPath(hostPath),
          isText,
          size: fileStats.size,
        });
        res.json({
          ok: true,
          path: hostPath,
          fileName: path.basename(hostPath),
          isText,
          size: fileStats.size,
          content: isText ? contentBuffer.toString("utf8") : "",
        });
      },
      { fallbackErrorKey: "common.readWorkspaceFileFailed" },
    ),
  );

  app.get(
    "/internal/host-file/download",
    jsonRoute(
      async (req, res) => {
        const requestedPath = String(req?.query?.path || "").trim();
        logHostFileAccess(req, "download.request", {
          hasPath: Boolean(requestedPath),
          hostPath: maskHostPath(requestedPath),
          isSandbox: String(req?.query?.isSandbox || ""),
        });
        assertHostAccessAllowed(req);
        const { hostPath, fileStats } = await resolveHostFilePath(req);
        logHostFileAccess(req, "download.response", {
          hostPath: maskHostPath(hostPath),
          size: fileStats.size,
        });
        res.download(hostPath, path.basename(hostPath));
      },
      { fallbackErrorKey: "common.downloadWorkspaceFileFailed" },
    ),
  );

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
