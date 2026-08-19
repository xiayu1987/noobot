/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { writeFileAtomic } from "@noobot/platform-compatibility/atomic-file-write";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { safeJoin } from "#agent/utils";
import { createJsonRouteWrapper } from "./route-wrapper.js";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const DEFAULT_I18N_KEYS = {
  treeFailed: "common.loadWorkspaceTreeFailed",
  readFailed: "common.readWorkspaceFileFailed",
  saveFailed: "common.saveWorkspaceFileFailed",
  downloadFailed: "common.downloadWorkspaceFileFailed",
};

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
    const normalized = String(pathValue || "")
      .trim()
      .replaceAll("\\", "/");
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
        let handle;
        try {
          handle = await open(absolutePath, "r");
        } catch (error) {
          logFileAccess(req, "file.accessFailed", {
            relativePath: maskWorkspacePath(relativePath),
            error: String(error?.code || error?.message || error || ""),
          });
          throw error;
        }
        let fileStats;
        let contentBuffer;
        try {
          fileStats = await handle.stat();
          if (!fileStats.isFile()) {
            throw new Error(translateText("common.pathIsNotFile", req.locale));
          }
          contentBuffer = await handle.readFile();
        } finally {
          await handle.close();
        }
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

  app.put(
    `${routePrefix}/file`,
    ...middlewares,
    jsonRoute(
      async (req, res) => {
        const relativePath = String(req.body?.path || "");
        const content = req.body?.content;
        if (!relativePath) throw new Error(translateText("common.pathRequired", req.locale));
        if (typeof content !== "string") {
          const error = new TypeError("workspace file content must be a string");
          error.status = 400;
          throw error;
        }
        if (Buffer.byteLength(content, "utf8") > LENGTH_THRESHOLDS.serviceHttp.workspaceFileBytes) {
          const error = new Error("workspace file content exceeds the configured size limit");
          error.status = 413;
          throw error;
        }
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFileAtomic({
          filePath: absolutePath,
          content,
          writeFile,
          rename,
          remove: rm,
        });
        res.json(buildSaveResponse({ req, path: relativePath }));
      },
      { fallbackErrorKey: keys.saveFailed },
    ),
  );

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
          const fileStats = await stat(absolutePath);
          if (fileStats.isFile()) {
            logFileAccess(req, "download.fileResponse", {
              relativePath: maskWorkspacePath(relativePath),
              size: fileStats.size,
            });
            res.download(absolutePath, path.basename(relativePath));
            return;
          }
          if (!fileStats.isDirectory())
            throw new Error(translateText("common.pathIsNotFile", req.locale));
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
