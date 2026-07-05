/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { safeJoin } from "#agent/utils";
import { createJsonRouteWrapper } from "./route-wrapper.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

/**
 * @typedef {Object} FileCrudRouteOptions
 * @property {string} routePrefix - URL prefix for the routes (e.g. "/internal/admin/workspace-all")
 * @property {(req?: import("express").Request) => (string | Promise<string>)} resolveRootPath - Function that returns the absolute root directory
 * @property {Function} [middleware] - Optional Express middleware(s) to apply to all routes (e.g. requireApiKey, requireSuperAdmin)
 * @property {Function} buildWorkspaceTree - Function to build directory tree
 * @property {Function} [buildDirectoryArchiveFile] - Function to create a zip archive of a directory. If omitted, the /download route is not registered.
 * @property {Function} translateText - i18n translation function
 * @property {Object} [i18nKeys] - Custom i18n key overrides
 * @property {string} [i18nKeys.treeFailed] - Default: "common.loadWorkspaceTreeFailed"
 * @property {string} [i18nKeys.readFailed] - Default: "common.readWorkspaceFileFailed"
 * @property {string} [i18nKeys.saveFailed] - Default: "common.saveWorkspaceFileFailed"
 * @property {string} [i18nKeys.downloadFailed] - Default: "common.downloadWorkspaceFileFailed"
 * @property {Object} [responseBuilders] - Optional response payload builders
 * @property {(ctx: {req: import("express").Request, root: string, tree: any}) => object} [responseBuilders.tree] - Build response for /tree
 * @property {(ctx: {req: import("express").Request, path: string, isText: boolean, size: number, content: string}) => object} [responseBuilders.file] - Build response for /file GET
 * @property {(ctx: {req: import("express").Request, path: string}) => object} [responseBuilders.save] - Build response for /file PUT
 * @property {boolean | ((req?: import("express").Request) => boolean)} [allowAbsolutePath] - Allow absolute file paths instead of constraining to root.
 */

const DEFAULT_I18N_KEYS = {
  treeFailed: "common.loadWorkspaceTreeFailed",
  readFailed: "common.readWorkspaceFileFailed",
  saveFailed: "common.saveWorkspaceFileFailed",
  downloadFailed: "common.downloadWorkspaceFileFailed",
};

/**
 * Register a standard set of file CRUD routes (tree, file read, file write, download)
 * on an Express app.
 *
 * The /download route is only registered when buildDirectoryArchiveFile is provided.
 *
 * @param {import("express").Application} app
 * @param {FileCrudRouteOptions} options
 */
export function registerFileCrudRoutes(
  app,
  {
    routePrefix,
    resolveRootPath,
    middleware,
    buildWorkspaceTree,
    buildDirectoryArchiveFile,
    translateText,
    i18nKeys = {},
    responseBuilders = {},
    allowAbsolutePath = false,
  } = {},
) {
  const keys = { ...DEFAULT_I18N_KEYS, ...i18nKeys };
  const middlewares = middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : [];
  const jsonRoute = createJsonRouteWrapper({ translateText });
  const buildTreeResponse =
    typeof responseBuilders?.tree === "function"
      ? responseBuilders.tree
      : ({ root, tree }) => ({ ok: true, root, tree });
  const buildFileResponse =
    typeof responseBuilders?.file === "function"
      ? responseBuilders.file
      : ({ path, isText, size, content }) => ({
          ok: true,
          path,
          isText,
          size,
          content,
        });
  const buildSaveResponse =
    typeof responseBuilders?.save === "function"
      ? responseBuilders.save
      : ({ path }) => ({ ok: true, path });

  const maskWorkspacePath = (pathValue = "") => {
    const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 2) return normalized;
    return `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}`;
  };

  const logFileAccess = (req, event, payload = {}) => {
    const traceId = String(req?.headers?.["x-noobot-file-trace-id"] || "").trim();
    if (!traceId) return;
    void writeRoutedRuntimeEvent({
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.DEBUG,
      level: "debug",
      event: "service.fileCrud.fileAccess.trace",
      data: {
        traceEvent: event,
        traceIdLength: traceId.length,
        routePrefixLength: String(routePrefix || "").length,
        ...payload,
      },
    });
  };

  const isAbsolutePathAllowed = (req) =>
    typeof allowAbsolutePath === "function"
      ? allowAbsolutePath(req) === true
      : allowAbsolutePath === true;

  const resolveRequestFilePath = (req, root, requestedPath = "") => {
    const normalizedPath = String(requestedPath || "");
    if (isAbsolutePathAllowed(req) && path.isAbsolute(normalizedPath)) {
      return path.resolve(normalizedPath);
    }
    return safeJoin(root, normalizedPath);
  };

  // GET tree
  app.get(
    `${routePrefix}/tree`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
      const root = await resolveRootPath(req);
      await mkdir(root, { recursive: true });
      const tree = await buildWorkspaceTree(root);
      res.json(buildTreeResponse({ req, root, tree }));
      },
      { fallbackErrorKey: keys.treeFailed },
    ),
  );

  // GET file
  app.get(
    `${routePrefix}/file`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
      const relativePath = String(req.query.path || "");
      logFileAccess(req, "file.request", {
        hasPath: Boolean(relativePath),
        relativePath: maskWorkspacePath(relativePath),
      });
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = await resolveRootPath(req);
      const absolutePath = resolveRequestFilePath(req, root, relativePath);
      try {
        await access(absolutePath);
      } catch (error) {
        logFileAccess(req, "file.accessFailed", {
          relativePath: maskWorkspacePath(relativePath),
          error: String(error?.code || error?.message || error || ""),
        });
        throw error;
      }
      const fileStats = await stat(absolutePath);
      if (!fileStats.isFile()) throw new Error(translateText("common.pathIsNotFile", req.locale));
      const contentBuffer = await readFile(absolutePath);
      const isText = !contentBuffer.includes(0);
      const content = isText ? contentBuffer.toString("utf8") : "";
      logFileAccess(req, "file.response", {
        relativePath: maskWorkspacePath(relativePath),
        isText,
        size: fileStats.size,
      });
      res.json(
        buildFileResponse({
          req,
          path: relativePath,
          isText,
          size: fileStats.size,
          content,
        }),
      );
      },
      { fallbackErrorKey: keys.readFailed },
    ),
  );

  // PUT file
  app.put(
    `${routePrefix}/file`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
      const relativePath = String(req.body?.path || "");
      const content = String(req.body?.content || "");
      if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
      const root = await resolveRootPath(req);
      const absolutePath = resolveRequestFilePath(req, root, relativePath);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      res.json(buildSaveResponse({ req, path: relativePath }));
      },
      { fallbackErrorKey: keys.saveFailed },
    ),
  );

  // GET download (only registered when buildDirectoryArchiveFile is provided)
  if (typeof buildDirectoryArchiveFile === "function") {
    app.get(
      `${routePrefix}/download`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
        const relativePath = String(req.query.path || "");
        logFileAccess(req, "download.request", {
          hasPath: Boolean(relativePath),
          relativePath: maskWorkspacePath(relativePath),
        });
        if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        try {
          await access(absolutePath);
        } catch (error) {
          logFileAccess(req, "download.accessFailed", {
            relativePath: maskWorkspacePath(relativePath),
            error: String(error?.code || error?.message || error || ""),
          });
          throw error;
        }
        const fileStats = await stat(absolutePath);
        if (fileStats.isFile()) {
          logFileAccess(req, "download.fileResponse", {
            relativePath: maskWorkspacePath(relativePath),
            size: fileStats.size,
          });
          res.download(absolutePath, path.basename(relativePath));
          return;
        }
        if (!fileStats.isDirectory()) throw new Error(translateText("common.pathIsNotFile", req.locale));
        logFileAccess(req, "download.directoryArchive", {
          relativePath: maskWorkspacePath(relativePath),
          size: fileStats.size,
        });
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
        },
        { fallbackErrorKey: keys.downloadFailed },
      ),
    );
  }
}
