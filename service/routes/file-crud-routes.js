/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import path from "node:path";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { writeFileAtomicCreatingParents } from "@noobot/platform-compatibility/atomic-file-write";
import {
  applyFileMutation,
  readFileMutation,
  readFileMutationDownload,
} from "noobot-agent/file-mutation-service";
import {
  createFileMutationLocator,
  createFileMutationDiffPreview,
  createFileMutationFilePreview,
  decodeFileMutationDownloadRequest,
} from "@noobot/file-mutation-protocol";
import { resolveMimeTypeFromFileName } from "@noobot/attachment-protocol/mime";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { safeJoin } from "#agent/utils";
import {
  classifyRequestedPathError,
  createBadRequestError,
  createJsonRouteWrapper,
  decodeRequestInput,
} from "./route-wrapper.js";
import { buildContentDisposition } from "./content-disposition.js";
import { recordFileAccessDebug } from "../runtime-events/file-access-debug.js";
import { text, isFunction } from "@noobot/shared/value";

const DEFAULT_I18N_KEYS = {
  treeFailed: "common.loadWorkspaceTreeFailed",
  readFailed: "common.readWorkspaceFileFailed",
  saveFailed: "common.saveWorkspaceFileFailed",
  downloadFailed: "common.downloadWorkspaceFileFailed",
};

const JSON_DOCUMENT_NAMES = new Set(["config.json", "config-params.json"]);
const UNSAFE_TEXT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function validateWorkspaceText(content) {
  if (typeof content !== "string") {
    throw createBadRequestError("workspace file content must be a string", {
      code: "INVALID_WORKSPACE_FILE_CONTENT",
    });
  }
  if (Buffer.byteLength(content, "utf8") > LENGTH_THRESHOLDS.serviceHttp.workspaceFileBytes) {
    const error = new Error("workspace file content exceeds the configured size limit");
    error.statusCode = 413;
    error.code = "WORKSPACE_FILE_CONTENT_TOO_LARGE";
    throw error;
  }
  if (UNSAFE_TEXT_CONTROL_CHARACTERS.test(content)) {
    throw createBadRequestError("workspace file content contains unsafe control characters", {
      code: "INVALID_WORKSPACE_FILE_CONTENT",
    });
  }
  return content;
}

function validateJsonDocumentWrite(relativePath, content) {
  if (!JSON_DOCUMENT_NAMES.has(path.basename(relativePath))) return;
  try {
    JSON.parse(content);
  } catch (error) {
    throw createBadRequestError(
      `${path.basename(relativePath)} parse failed: ${error?.message || String(error)}`,
      { code: "INVALID_JSON_DOCUMENT" },
    );
  }
}

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
    resolveMutationRoot = null,
    trackMutations = false,
    readMutations = false,
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
  const maskWorkspacePath = (pathValue = "") => {
    const normalized = text(pathValue).replaceAll("\\", "/");
    const parts = normalized.match(/[^/]+/g) || [];
    return parts.length > 2
      ? `${parts.slice(0, 2).join("/")}/.../${parts[parts.length - 1]}`
      : normalized;
  };

  const logFileAccess = (req, event, payload = {}) =>
    recordFileAccessDebug(req, {
      event: "service.fileCrud.fileAccess.trace",
      traceEvent: event,
      data: { routePrefixLength: String(routePrefix || "").length, ...payload },
    });

  const isAbsolutePathAllowed = (req) =>
    typeof allowAbsolutePath === "function"
      ? allowAbsolutePath(req) === true
      : allowAbsolutePath === true;

  const resolveRequestFilePath = (req, root, requestedPath = "") => {
    const normalizedPath = String(requestedPath || "");
    if (isAbsolutePathAllowed(req) && path.isAbsolute(normalizedPath)) {
      return path.resolve(normalizedPath);
    }
    return decodeRequestInput(() => safeJoin(root, normalizedPath));
  };

  const resolveRequestMutationLocator = (req, requestedPath, absolutePath) =>
    isAbsolutePathAllowed(req) && path.isAbsolute(requestedPath)
      ? createFileMutationLocator({ view: "host", path: absolutePath })
      : createFileMutationLocator({ view: "workspace", path: requestedPath });

  const resolveRequestMutationRoot = async (req, root) => {
    if (!isFunction(resolveMutationRoot)) {
      throw new Error("file mutation session scope resolver is required");
    }
    const resolved = await resolveMutationRoot(req, root);
    if (!text(resolved)) throw new Error("file mutation repository root is required");
    return resolved;
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
        if (!relativePath) {
          throw createBadRequestError(translateText("common.pathRequired", req.locale));
        }
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
          throw classifyRequestedPathError(error);
        }
        let fileStats;
        let contentBuffer;
        try {
          fileStats = await handle.stat();
          if (!fileStats.isFile()) {
            throw createBadRequestError(translateText("common.pathIsNotFile", req.locale));
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
        if (!relativePath) {
          throw createBadRequestError(translateText("common.pathRequired", req.locale));
        }
        const content = validateWorkspaceText(req.body?.content);
        validateJsonDocumentWrite(relativePath, content);
        const root = await resolveRootPath(req);
        const absolutePath = resolveRequestFilePath(req, root, relativePath);
        const writeText = (target, value) =>
          writeFileAtomicCreatingParents({
            filePath: target,
            content: value,
            mkdir,
            writeFile,
            rename,
            remove: rm,
          });
        const result = trackMutations
          ? await applyFileMutation({
              filePath: absolutePath,
              locator: resolveRequestMutationLocator(req, relativePath, absolutePath),
              content,
              operation: "replace",
              mutationRoot: await resolveRequestMutationRoot(req, root),
              sessionScope: null,
              writeText,
            })
          : (await writeText(absolutePath, content),
            {
              ok: true,
              path: relativePath,
              isText: true,
              size: Buffer.byteLength(content, "utf8"),
              content,
            });
        res.json(result);
      },
      { fallbackErrorKey: keys.saveFailed },
    ),
  );

  if (readMutations === true) {
    app.get(
      `${routePrefix}/file-mutations/:mutationId/diff`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const root = await resolveRootPath(req);
          const mutation = await readFileMutation({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
          });
          res.json(createFileMutationDiffPreview(mutation));
        },
        { fallbackErrorKey: keys.readFailed },
      ),
    );

    app.get(
      `${routePrefix}/file-mutations/:mutationId/file`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const root = await resolveRootPath(req);
          const mutation = await readFileMutation({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
          });
          res.json(createFileMutationFilePreview(mutation));
        },
        { fallbackErrorKey: keys.readFailed },
      ),
    );

    app.get(
      `${routePrefix}/file-mutations/:mutationId/download`,
      ...middlewares,
      jsonRoute(
        async (req, res) => {
          const { revision, afterSha256 } = decodeFileMutationDownloadRequest(req.query);
          const root = await resolveRootPath(req);
          const download = await readFileMutationDownload({
            mutationRoot: await resolveRequestMutationRoot(req, root),
            mutationId: req.params.mutationId,
            revision,
            afterSha256,
          });
          res.setHeader("Content-Type", resolveMimeTypeFromFileName(download.fileName));
          res.setHeader(
            "Content-Disposition",
            buildContentDisposition("attachment", download.fileName),
          );
          res.setHeader("Content-Length", String(download.content.length));
          res.end(download.content);
        },
        { fallbackErrorKey: keys.downloadFailed },
      ),
    );
  }

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
          if (!relativePath) {
            throw createBadRequestError(translateText("common.pathRequired", req.locale));
          }
          const root = await resolveRootPath(req);
          const absolutePath = resolveRequestFilePath(req, root, relativePath);
          const fileStats = await stat(absolutePath).catch((error) => {
            throw classifyRequestedPathError(error);
          });
          if (fileStats.isFile()) {
            logFileAccess(req, "download.fileResponse", {
              relativePath: maskWorkspacePath(relativePath),
              size: fileStats.size,
            });
            res.download(absolutePath, path.basename(relativePath));
            return;
          }
          if (!fileStats.isDirectory())
            throw createBadRequestError(translateText("common.pathIsNotFile", req.locale));
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
